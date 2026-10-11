import { GET as callback } from '@/app/api/auth/yandex/callback/route';
import { GET as start } from '@/app/api/auth/yandex/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { OAUTH_COOKIE, signOAuthState } from '@/server/auth/yandex';
import { resetEnvCache } from '@/server/env';
import { parseSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom } from '../../helpers/requests';

type Reply = { status: number; body: unknown };

/** Подменённый fetch: token и info отвечают заданным; записывает запросы (без сети). */
function mockYandex(token: Reply, info: Reply) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = url.startsWith('https://oauth.yandex.ru/token') ? token : url.startsWith('https://login.yandex.ru/info') ? info : null;
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const OK_TOKEN: Reply = { status: 200, body: { access_token: 'y0_secret_token', token_type: 'bearer', expires_in: 3600 } };
const info = (extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { id: '1000123', login: 'ivan.p', client_id: 'cid', psuid: 'x', real_name: 'Иван Петров', default_email: 'Ivan.P@yandex.ru', ...extra },
});

/** Старт (галка согласия отмечена) → (state, кука) → запрос callback с этой кукой. */
async function begin(next?: string) {
  const qs = new URLSearchParams({ consent: CONSENT_VERSION, ...(next ? { next } : {}) });
  const res = start(new Request(`http://localhost:3000/api/auth/yandex?${qs.toString()}`));
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get('location')!);
  const cookie = cookieFrom(res, OAUTH_COOKIE)!;
  return { state: loc.searchParams.get('state')!, cookie, loc, setCookie: res.headers.get('set-cookie') ?? '' };
}

const cb = (query: string, cookie?: string) =>
  callback(new Request(`http://localhost:3000/api/auth/yandex/callback?${query}`, { headers: cookie ? { cookie } : {} }));

const sessionOf = (res: Response) => parseSession(cookieFrom(res)?.slice('cid='.length));

describe('вход через Яндекс ID (callback, fetch замокан)', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.YANDEX_CLIENT_ID = 'test-client-id';
    process.env.YANDEX_CLIENT_SECRET = 'test-client-secret';
    process.env.APP_URL = 'http://localhost:3000';
    resetEnvCache();
  });
  afterAll(async () => {
    process.env = saved;
    resetEnvCache();
    await prisma.$disconnect();
  });
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());

  it('старт: редирект на oauth.yandex.ru с PKCE S256, кука state httpOnly, короткая, на путь callback', async () => {
    const { loc, setCookie } = await begin();
    expect(loc.origin).toBe('https://oauth.yandex.ru');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/yandex/callback');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Max-Age=600/i);
    expect(setCookie).toMatch(/Path=\/api\/auth\/yandex/i);
  });

  it('успех: новый аккаунт pending → /consultant, кука сессии, токен не сохранён', async () => {
    const calls = mockYandex(OK_TOKEN, info());
    const { state, cookie } = await begin('/profile');
    const res = await cb(`code=1234567&state=${state}`, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost:3000/consultant');
    const s = sessionOf(res);
    expect(s).toMatchObject({ role: 'pending', candidateId: null });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: s!.userId! }, include: { accounts: true } });
    expect(user).toMatchObject({ name: 'Иван Петров', email: 'ivan.p@yandex.ru', role: 'pending' });
    expect(user.accounts).toEqual([expect.objectContaining({ provider: 'yandex', providerAccountId: '1000123' })]);
    // Обмен: PKCE verifier передан, токен в профиль – заголовком OAuth.
    const tokenBody = new URLSearchParams(String(calls[0]!.init!.body));
    expect(tokenBody.get('grant_type')).toBe('authorization_code');
    expect(tokenBody.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(new Headers(calls[1]!.init!.headers).get('authorization')).toBe('OAuth y0_secret_token');
    // Галка согласия с /auth записана так же, как раньше шаг чата: версия и время.
    expect(await prisma.consent.findMany({ where: { userId: user.id } })).toEqual([expect.objectContaining({ version: CONSENT_VERSION })]);
    // Токен Яндекса нигде в БД не лежит.
    const dump = JSON.stringify(await prisma.authAccount.findMany()) + JSON.stringify(await prisma.user.findMany());
    expect(dump).not.toContain('y0_secret_token');
  });

  it('без галки согласия (или с устаревшей версией) в Яндекс не ведём: /auth?error=consent_required, куки state нет', async () => {
    for (const q of ['', '?consent=old-version', '?next=%2Fprofile']) {
      const res = start(new Request(`http://localhost:3000/api/auth/yandex${q}`));
      expect(res.headers.get('location')).toBe('http://localhost:3000/auth?error=consent_required');
      expect(cookieFrom(res, OAUTH_COOKIE)).toBeUndefined();
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it('версия согласия сменилась между стартом и возвратом: /auth?error=consent_required, аккаунт и обмен не созданы', async () => {
    const calls = mockYandex(OK_TOKEN, info());
    const state = 'state-value-for-stale-consent';
    const old = signOAuthState({ state, verifier: 'v'.repeat(64), next: null, consent: 'old-version', exp: Math.floor(Date.now() / 1000) + 600 });
    const res = await cb(`code=1234567&state=${state}`, `${OAUTH_COOKIE}=${old}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost:3000/auth?error=consent_required');
    expect(calls).toHaveLength(0);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.consent.count()).toBe(0);
  });

  it('неверный state или нет куки → /auth?error=state, обмена нет', async () => {
    const calls = mockYandex(OK_TOKEN, info());
    const { cookie } = await begin();
    expect((await cb('code=1234567&state=forged-state-value', cookie)).headers.get('location')).toBe('http://localhost:3000/auth?error=state');
    const { state } = await begin();
    expect((await cb(`code=1234567&state=${state}`)).headers.get('location')).toBe('http://localhost:3000/auth?error=state');
    expect(calls).toHaveLength(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it('отказ пользователя на Яндексе → /auth?error=yandex_denied', async () => {
    const { state, cookie } = await begin();
    const res = await cb(`error=access_denied&state=${state}`, cookie);
    expect(res.headers.get('location')).toBe('http://localhost:3000/auth?error=yandex_denied');
  });

  it('ошибка обмена кода → /auth?error=exchange, аккаунт не создан, токен не в логах', async () => {
    mockYandex({ status: 400, body: { error: 'invalid_grant', error_description: 'Code has expired' } }, info());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { state, cookie } = await begin();
    const res = await cb(`code=1234567&state=${state}`, cookie);
    expect(res.headers.get('location')).toBe('http://localhost:3000/auth?error=exchange');
    expect(cookieFrom(res)).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('1234567');
    warn.mockRestore();
  });

  it('нет почты (право не выдано) → аккаунт с email = null', async () => {
    mockYandex(OK_TOKEN, info({ default_email: undefined, real_name: undefined, display_name: 'ivan' }));
    const { state, cookie } = await begin();
    const res = await cb(`code=1234567&state=${state}`, cookie);
    expect(res.headers.get('location')).toBe('http://localhost:3000/consultant');
    const user = await prisma.user.findFirstOrThrow();
    expect(user).toMatchObject({ email: null, name: 'ivan' });
  });

  it('повторный вход того же аккаунта: тот же User; онбординг пройден → next или кабинет роли', async () => {
    mockYandex(OK_TOKEN, info());
    let { state, cookie } = await begin();
    const first = sessionOf(await cb(`code=1234567&state=${state}`, cookie))!;
    const cand = await prisma.candidate.create({ data: { name: 'Иван', email: 'ivan.p@yandex.ru' } });
    await prisma.user.update({ where: { id: first.userId! }, data: { role: 'candidate', candidateId: cand.id, onboardedAt: new Date() } });

    ({ state, cookie } = await begin('/profile'));
    const again = await cb(`code=7654321&state=${state}`, cookie);
    expect(again.headers.get('location')).toBe('http://localhost:3000/profile');
    expect(sessionOf(again)).toMatchObject({ userId: first.userId, role: 'candidate', candidateId: cand.id });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.authAccount.count()).toBe(1);

    ({ state, cookie } = await begin());
    expect((await cb(`code=7654321&state=${state}`, cookie)).headers.get('location')).toBe('http://localhost:3000/consultant');
  });

  it('без YANDEX_CLIENT_ID/SECRET старт ведёт на /auth с пояснением', async () => {
    delete process.env.YANDEX_CLIENT_ID;
    resetEnvCache();
    try {
      const res = start(new Request('http://localhost:3000/api/auth/yandex'));
      expect(res.headers.get('location')).toBe('http://localhost:3000/auth?error=yandex_not_configured');
    } finally {
      process.env.YANDEX_CLIENT_ID = 'test-client-id';
      resetEnvCache();
    }
  });
});
