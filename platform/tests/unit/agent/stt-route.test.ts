import { parseEnv } from '@/server/env';

const env = parseEnv({ DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: 'x'.repeat(32), YANDEX_API_KEY: 'AQVNsecret', YANDEX_FOLDER_ID: 'b1g' });
vi.mock('@/server/env', async (orig) => ({ ...(await orig<typeof import('@/server/env')>()), getEnv: () => env }));
let session: object | null = { userId: 'u1', role: 'candidate' };
vi.mock('@/server/session', () => ({ getSession: () => session, parseSession: () => null, readCookie: () => undefined, SESSION_COOKIE: 'cid' }));

const { GET, POST } = await import('@/app/api/stt/route');

afterEach(() => {
  vi.unstubAllGlobals();
  session = { userId: 'u1', role: 'candidate' };
});

const post = (body: Uint8Array) => new Request('http://localhost/api/stt', { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'audio/l16; rate=16000' } });

describe('/api/stt', () => {
  it('GET отдаёт режим', async () => {
    const res = await GET();
    expect(await res.json()).toMatchObject({ mode: 'yandex', sampleRate: 16000 });
  });

  it('POST: аудио уходит в SpeechKit как есть, в ответе – текст', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 'привет' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(post(new Uint8Array(3200)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'привет' });
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('stt.api.cloud.yandex.net');
  });

  it('POST без входа – 401, больше 1 МБ – 413, без запроса к SpeechKit', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    session = null;
    expect((await POST(post(new Uint8Array(10)))).status).toBe(401);
    session = { userId: 'u1' };
    expect((await POST(post(new Uint8Array(1024 * 1024 + 1)))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
