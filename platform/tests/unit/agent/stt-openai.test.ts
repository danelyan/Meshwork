import { parseEnv } from '@/server/env';
import { STT_MAX_BYTES, pcmToWav, recognizeOpenai, sttMode } from '@/server/stt';

const base = { DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: 'x'.repeat(32) };
const keys = { STT_OPENAI_BASE_URL: 'https://w.example/v1/', STT_OPENAI_API_KEY: 'sk-test' };

describe('stt openai: режим и env', () => {
  it('openai с ключами — openai; без — ошибка env; auto openai не выбирает', () => {
    expect(sttMode(parseEnv({ ...base, STT_PROVIDER: 'openai', ...keys }))).toBe('openai');
    expect(() => parseEnv({ ...base, STT_PROVIDER: 'openai' })).toThrow(/STT_OPENAI_BASE_URL/);
    expect(sttMode(parseEnv({ ...base, ...keys }))).toBe('browser');
    expect(parseEnv({ ...base, ...keys }).STT_OPENAI_MODEL).toBe('whisper-large-v3');
  });
});

describe('stt openai: WAV', () => {
  it('44-байтный RIFF, 16 кГц, 16 бит, моно, размеры', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const w = pcmToWav(pcm);
    const v = new DataView(w.buffer);
    expect(w.byteLength).toBe(48);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(40);
    expect(String.fromCharCode(...w.subarray(8, 16))).toBe('WAVEfmt ');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(4);
    expect([...w.subarray(44)]).toEqual([1, 2, 3, 4]);
  });
});

describe('stt openai: запрос (fetch замокан)', () => {
  it('multipart-поля, Bearer, URL без двойного слэша, разбор text', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ text: ' привет мир ' }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await recognizeOpenai(new Uint8Array(3200), { baseUrl: 'https://w.example/v1/', apiKey: 'sk-test', fetchImpl });
    expect(text).toBe('привет мир');
    const call = calls[0] as { url: string; init: RequestInit };
    expect(call.url).toBe('https://w.example/v1/audio/transcriptions');
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const form = call.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('language')).toBe('ru');
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file') as File;
    expect(file.name).toBe('audio.wav');
    expect(file.size).toBe(3244);
  });

  it('пустой ответ — пустая строка; своя модель', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    expect(await recognizeOpenai(new Uint8Array(10), { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl })).toBe('');
  });

  it('ошибки: пусто 400, длинно 413, 429 rate_limited, 4xx/5xx и сеть/таймаут stt_unavailable 503', async () => {
    const mk = (r: () => Response | Promise<Response>) => (async () => r()) as unknown as typeof fetch;
    const o = { baseUrl: 'http://x/v1', apiKey: 'k' };
    await expect(recognizeOpenai(new Uint8Array(0), { ...o, fetchImpl: mk(() => new Response('{}')) })).rejects.toMatchObject({ status: 400 });
    await expect(recognizeOpenai(new Uint8Array(STT_MAX_BYTES + 1), { ...o, fetchImpl: mk(() => new Response('{}')) })).rejects.toMatchObject({ status: 413 });
    await expect(recognizeOpenai(new Uint8Array(10), { ...o, fetchImpl: mk(() => new Response('', { status: 429 })) })).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    await expect(recognizeOpenai(new Uint8Array(10), { ...o, fetchImpl: mk(() => new Response('', { status: 401 })) })).rejects.toMatchObject({ status: 503, code: 'stt_unavailable' });
    await expect(recognizeOpenai(new Uint8Array(10), { ...o, fetchImpl: mk(() => new Response('', { status: 500 })) })).rejects.toMatchObject({ status: 503 });
    await expect(recognizeOpenai(new Uint8Array(10), { ...o, fetchImpl: mk(() => { throw new DOMException('t', 'TimeoutError'); }) })).rejects.toMatchObject({ status: 503, code: 'stt_unavailable' });
  });
});
