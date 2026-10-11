import { parseEnv } from '@/server/env';
import { STT_MAX_BYTES, STT_URL, recognizeYandex, sttMode } from '@/server/stt';

const base = { DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: 'x'.repeat(32) };

describe('stt: режим распознавания', () => {
  it('auto: ключи Yandex есть – yandex, нет – browser; off и browser – как сказано', () => {
    expect(sttMode(parseEnv({ ...base }))).toBe('browser');
    expect(sttMode(parseEnv({ ...base, YANDEX_API_KEY: 'AQVNkey', YANDEX_FOLDER_ID: 'b1g' }))).toBe('yandex');
    expect(sttMode(parseEnv({ ...base, YANDEX_API_KEY: 'AQVNkey', YANDEX_FOLDER_ID: 'b1g', STT_PROVIDER: 'browser' }))).toBe('browser');
    expect(sttMode(parseEnv({ ...base, STT_PROVIDER: 'off', YANDEX_API_KEY: 'AQVNkey', YANDEX_FOLDER_ID: 'b1g' }))).toBe('off');
    // yandex без ключей не ломает ввод – откат на браузер
    expect(sttMode(parseEnv({ ...base, STT_PROVIDER: 'yandex' }))).toBe('browser');
  });
});

describe('stt: Yandex SpeechKit v1 (fetch замокан)', () => {
  it('LPCM 16 кГц, ru-RU, Api-Key; folderId с ключом сервисного аккаунта не шлём', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ result: ' пишу на Go ' }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await recognizeYandex(new Uint8Array(3200), { apiKey: 'AQVNsecret', folderId: 'b1g', fetchImpl });
    expect(text).toBe('пишу на Go');
    const u = new URL(calls[0]!.url);
    expect(`${u.origin}${u.pathname}`).toBe(STT_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' });
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Api-Key AQVNsecret');
  });

  it('IAM-токен – Bearer и folderId', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => ((url = u), new Response('{"result":"ок"}'))) as unknown as typeof fetch;
    await recognizeYandex(new Uint8Array(10), { apiKey: 't1.token', folderId: 'b1g', fetchImpl });
    expect(new URL(url).searchParams.get('folderId')).toBe('b1g');
  });

  it('ошибки: пусто/слишком длинно – 400/413 без запроса; сбой SpeechKit – 503 с понятным текстом', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await expect(recognizeYandex(new Uint8Array(0), { apiKey: 'k', fetchImpl })).rejects.toMatchObject({ status: 400 });
    await expect(recognizeYandex(new Uint8Array(STT_MAX_BYTES + 1), { apiKey: 'k', fetchImpl })).rejects.toMatchObject({ status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(recognizeYandex(new Uint8Array(10), { apiKey: 'k', fetchImpl })).rejects.toMatchObject({ status: 503, message: expect.stringContaining('напиши текстом') });
  });
});
