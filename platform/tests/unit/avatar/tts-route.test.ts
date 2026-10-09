import { parseEnv } from '@/server/env';

let env = parseEnv({ DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: 'x'.repeat(32), YANDEX_API_KEY: 'AQVNsecret', YANDEX_FOLDER_ID: 'b1g' });
vi.mock('@/server/env', async (orig) => ({ ...(await orig<typeof import('@/server/env')>()), getEnv: () => env }));
let session: object | null = { userId: 'u1', role: 'candidate', candidateId: 'c1' };
vi.mock('@/server/session', () => ({ getSession: () => session, parseSession: () => null, readCookie: () => undefined, SESSION_COOKIE: 'cid' }));

const { GET, POST } = await import('@/app/api/tts/route');
const { resetTtsRateLimit, ttsMode, ttsRateLimit, TTS_RATE } = await import('@/server/tts');

const baseEnv = env;
afterEach(() => {
  vi.unstubAllGlobals();
  session = { userId: 'u1', role: 'candidate', candidateId: 'c1' };
  env = baseEnv;
  resetTtsRateLimit();
});

const post = (text: unknown) => new Request('http://localhost/api/tts', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } });
const okAudio = () => vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { 'content-type': 'audio/mp3' } }));

describe('/api/tts', () => {
  it('GET отдаёт режим и лимит', async () => {
    expect(await (await GET()).json()).toEqual({ mode: 'yandex', maxChars: 1000 });
  });

  it('режим: auto без ключей и off — выключено', () => {
    expect(ttsMode(parseEnv({ DATABASE_URL: 'postgresql://x@l/db', SESSION_SECRET: 'x'.repeat(32) }))).toBe('off');
    expect(ttsMode({ ...baseEnv, TTS_PROVIDER: 'off' })).toBe('off');
  });

  it('POST: очищенный текст уходит в SpeechKit v1 формой, в ответ — mp3 без кэша', async () => {
    const fetchMock = okAudio();
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(post('**Привет!** Смотри [профиль](https://x.ru/p)'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize');
    expect((init.headers as Record<string, string>).Authorization).toBe('Api-Key AQVNsecret');
    const form = init.body as URLSearchParams;
    expect(form.get('text')).toBe('Привет! Смотри профиль');
    expect(Object.fromEntries(form)).toMatchObject({ lang: 'ru-RU', voice: 'marina', emotion: 'neutral', format: 'mp3', speed: '1.10' });
    expect(form.has('folderId')).toBe(false); // с API-ключом folderId не передаётся
  });

  it('без входа — 401, без ключей — 400, длиннее 1000 знаков — 413; SpeechKit не вызывается', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    session = null;
    expect((await POST(post('привет'))).status).toBe(401);
    session = { userId: 'u1' };
    expect((await POST(post('а'.repeat(1001)))).status).toBe(413);
    expect((await POST(post(''))).status).toBe(400);
    expect((await POST(post('```\ncode\n```'))).status).toBe(400); // после чистки пусто
    env = { ...baseEnv, TTS_PROVIDER: 'off' };
    expect((await POST(post('привет'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('лимит на сессию: 21-й запрос за минуту — 429', async () => {
    vi.stubGlobal('fetch', okAudio());
    for (let i = 0; i < TTS_RATE.max; i++) expect((await POST(post(`фраза ${i}`))).status).toBe(200);
    expect((await POST(post('ещё'))).status).toBe(429);
    session = { userId: 'u2' };
    expect((await POST(post('другой человек'))).status).toBe(200);
  });

  it('лимит по знакам и сброс окна', () => {
    const rate = { windowMs: 1000, max: 100, charsPerWindow: 50 };
    expect(ttsRateLimit('k', 40, 0, rate)).toBe(true);
    expect(ttsRateLimit('k', 20, 10, rate)).toBe(false);
    expect(ttsRateLimit('k', 20, 1200, rate)).toBe(true);
  });

  it('ошибка SpeechKit → 503 tts_unavailable, 429 → 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const res = await POST(post('привет'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'tts_unavailable' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    expect((await POST(post('привет'))).status).toBe(429);
  });
});
