import { parseEnv } from '@/server/env';

const env = parseEnv({ DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: 'x'.repeat(32), YANDEX_API_KEY: 'AQVNsecret', YANDEX_FOLDER_ID: 'b1g' });
vi.mock('@/server/env', async (orig) => ({ ...(await orig<typeof import('@/server/env')>()), getEnv: () => env }));
let session: object | null = { userId: 'u1', role: 'candidate' };
vi.mock('@/server/session', () => ({ getSession: () => session, parseSession: () => null, readCookie: () => undefined, SESSION_COOKIE: 'cid' }));

const { POST } = await import('@/app/api/stt/route');
const { STT_MAX_BYTES, STT_RATE, resetSttRateLimit, sttRateLimit } = await import('@/server/stt');

afterEach(() => {
  vi.unstubAllGlobals();
  session = { userId: 'u1', role: 'candidate' };
  resetSttRateLimit();
});

const post = (bytes = 3200, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/stt', {
    method: 'POST',
    body: new Uint8Array(bytes) as unknown as BodyInit,
    headers: { 'content-type': 'audio/l16; rate=16000', ...headers },
  });
const recognizer = () => vi.fn(async () => new Response(JSON.stringify({ result: 'привет' }), { status: 200 }));

describe('/api/stt: лимит запросов на сессию', () => {
  it('в пределах лимита все запросы проходят, следующий за минуту — 429 в формате ошибок, без запроса к распознаванию', async () => {
    const fetchMock = recognizer();
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < STT_RATE.max; i++) expect((await POST(post())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(STT_RATE.max);

    const res = await POST(post());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('rate_limited');
    expect(typeof body.error.message).toBe('string');
    expect(fetchMock).toHaveBeenCalledTimes(STT_RATE.max);
  });

  it('лимит свой у каждой сессии; старая кука без аккаунта считается по candidateId', async () => {
    vi.stubGlobal('fetch', recognizer());
    for (let i = 0; i < STT_RATE.max; i++) await POST(post());
    expect((await POST(post())).status).toBe(429);
    session = { userId: 'u2', role: 'candidate' };
    expect((await POST(post())).status).toBe(200);
    session = { userId: null, candidateId: 'c9', role: 'candidate' };
    expect((await POST(post())).status).toBe(200);
  });

  it('отказ до чтения тела (без входа, заявленный размер больше лимита) лимит не расходует', async () => {
    vi.stubGlobal('fetch', recognizer());
    session = null;
    for (let i = 0; i < STT_RATE.max + 5; i++) expect((await POST(post(10))).status).toBe(401);
    session = { userId: 'u1', role: 'candidate' };
    for (let i = 0; i < STT_RATE.max + 5; i++) {
      expect((await POST(post(10, { 'content-length': String(STT_MAX_BYTES + 1) }))).status).toBe(413);
    }
    expect((await POST(post())).status).toBe(200);
  });

  it('обычная диктовка в лимит не упирается: запись до 30 с — это единицы запросов в минуту', () => {
    expect(STT_RATE.windowMs).toBe(60_000);
    expect(STT_RATE.max).toBeGreaterThanOrEqual(20);
  });

  it('запрос с чужого сайта (Origin) — 403 до распознавания и без расхода лимита', async () => {
    const fetchMock = recognizer();
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < STT_RATE.max + 5; i++) {
      const res = await POST(post(3200, { origin: 'https://evil.example' }));
      expect(res.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await POST(post(3200, { origin: 'http://localhost' }))).status).toBe(200);
  });

  it('sttRateLimit: скользящее окно', () => {
    const rate = { windowMs: 1000, max: 2 };
    expect(sttRateLimit('k', 0, rate)).toBe(true);
    expect(sttRateLimit('k', 10, rate)).toBe(true);
    expect(sttRateLimit('k', 20, rate)).toBe(false);
    expect(sttRateLimit('other', 20, rate)).toBe(true);
    expect(sttRateLimit('k', 1005, rate)).toBe(true); // первое обращение вышло из окна
    expect(sttRateLimit('k', 1006, rate)).toBe(false);
  });
});
