import { POST as forgot } from '@/app/api/auth/password/forgot/route';
import { POST as reset } from '@/app/api/auth/password/reset/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as verify } from '@/app/api/auth/verify/route';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as consent } from '@/app/api/auth/consent/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { resetEnvCache } from '@/server/env';
import { clearMailOutbox, mailOutbox } from '@/server/mail';
import { parseSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const PASS = 'very-secret-1';
const lastCode = (to: string, kind: string) => {
  const m = [...mailOutbox()].reverse().find((x) => x.to === to && x.kind === kind);
  return /(\d{6})/.exec(m?.subject ?? '')?.[1];
};
/** По умолчанию — запрос к стенду (не localhost): код в ответ не попадает, только в письмо. */
const STAND = 'https://fsp.example.test';
const post = (handler: (r: Request) => Promise<Response>, url: string, body: unknown, base = STAND) =>
  handler(jsonRequest(`${base}${url}`, 'POST', body));

async function registerAndVerify(email: string) {
  expect((await post(register, '/api/auth/register', { email, password: PASS, consent: CONSENT_VERSION })).status).toBe(200);
  const res = await post(verify, '/api/auth/verify', { email, code: lastCode(email, 'verify') });
  expect(res.status).toBe(200);
  return res;
}

describe('вход по почте: регистрация, подтверждение, пароль', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    clearMailOutbox();
    process.env.DEMO_LOGIN = 'false';
    resetEnvCache();
  });
  afterEach(() => {
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
  });

  it('register → verify → login: код в письме, аккаунт pending с согласием, кука сессии', async () => {
    const res = await post(register, '/api/auth/register', { email: '  Ivan@Example.TEST ', password: PASS, consent: CONSENT_VERSION });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'ivan@example.test' }, include: { accounts: true, consents: true } });
    expect(user).toMatchObject({ role: 'pending', emailVerifiedAt: null });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.accounts).toEqual([expect.objectContaining({ provider: 'email', providerAccountId: 'ivan@example.test' })]);
    expect(user.consents).toEqual([expect.objectContaining({ version: CONSENT_VERSION })]);
    const stored = await prisma.authCode.findFirstOrThrow({ where: { userId: user.id } });
    const code = lastCode('ivan@example.test', 'verify')!;
    expect(stored.codeHash).not.toContain(code);

    // До подтверждения вход закрыт: 403, новый код.
    const early = await post(login, '/api/auth/login', { email: 'ivan@example.test', password: PASS });
    expect(early.status).toBe(403);
    expect((await early.json()).error.code).toBe('email_not_verified');
    const fresh = lastCode('ivan@example.test', 'verify')!;

    const ok = await post(verify, '/api/auth/verify', { email: 'ivan@example.test', code: fresh });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ next: '/consultant' });
    expect(parseSession(cookieFrom(ok)!.slice(4))).toMatchObject({ userId: user.id, role: 'pending' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeInstanceOf(Date);

    const in2 = await post(login, '/api/auth/login', { email: 'IVAN@example.test', password: PASS });
    expect(in2.status).toBe(200);
    expect(parseSession(cookieFrom(in2)!.slice(4))?.userId).toBe(user.id);
  });

  it('без согласия аккаунт не создаётся; короткий пароль и кривая почта — 400', async () => {
    expect((await post(register, '/api/auth/register', { email: 'a@example.test', password: PASS, consent: 'old' })).status).toBe(409);
    expect((await post(register, '/api/auth/register', { email: 'a@example.test', password: 'short', consent: CONSENT_VERSION })).status).toBe(400);
    expect((await post(register, '/api/auth/register', { email: 'not-email', password: PASS, consent: CONSENT_VERSION })).status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('неверный пароль и неизвестная почта — одинаковый 401', async () => {
    await registerAndVerify('ivan@example.test');
    const wrong = await post(login, '/api/auth/login', { email: 'ivan@example.test', password: 'nope-nope-nope' });
    const unknown = await post(login, '/api/auth/login', { email: 'ghost@example.test', password: PASS });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(cookieFrom(wrong)).toBeUndefined();
  });

  it('чужой код не подходит; 5 неверных попыток сжигают код', async () => {
    await post(register, '/api/auth/register', { email: 'a@example.test', password: PASS, consent: CONSENT_VERSION });
    await post(register, '/api/auth/register', { email: 'b@example.test', password: PASS, consent: CONSENT_VERSION });
    const codeA = lastCode('a@example.test', 'verify')!;
    const codeB = lastCode('b@example.test', 'verify')!;
    const foreign = await post(verify, '/api/auth/verify', { email: 'a@example.test', code: codeB === codeA ? '000000' : codeB });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error.code).toBe('invalid_code');

    const bad = codeA === '111111' ? '222222' : '111111';
    for (let i = 0; i < 4; i++) await post(verify, '/api/auth/verify', { email: 'a@example.test', code: bad });
    const burnt = await post(verify, '/api/auth/verify', { email: 'a@example.test', code: codeA });
    expect((await burnt.json()).error.code).toBe('code_exhausted');
    expect((await prisma.user.findFirstOrThrow({ where: { email: 'a@example.test' } })).emailVerifiedAt).toBeNull();
  });

  it('просроченный код — отказ', async () => {
    await post(register, '/api/auth/register', { email: 'a@example.test', password: PASS, consent: CONSENT_VERSION });
    await prisma.authCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await post(verify, '/api/auth/verify', { email: 'a@example.test', code: lastCode('a@example.test', 'verify') });
    expect((await res.json()).error.code).toBe('code_expired');
  });

  it('повторная регистрация на подтверждённую почту: тот же ответ, пароль не меняется, владельцу письмо', async () => {
    await registerAndVerify('ivan@example.test');
    const before = (await prisma.user.findFirstOrThrow({ where: { email: 'ivan@example.test' } })).passwordHash;
    const res = await post(register, '/api/auth/register', { email: 'ivan@example.test', password: 'attacker-pass', consent: CONSENT_VERSION });
    expect(await res.json()).toEqual({ sent: true });
    expect((await prisma.user.findFirstOrThrow({ where: { email: 'ivan@example.test' } })).passwordHash).toBe(before);
    expect(mailOutbox().at(-1)).toMatchObject({ to: 'ivan@example.test', kind: 'already_registered' });
  });

  it('Яндекс-аккаунт с той же почтой не склеивается с email-аккаунтом (ADR 0001 п. 6)', async () => {
    await prisma.user.create({ data: { name: 'Я', email: 'ivan@example.test', accounts: { create: { provider: 'yandex', providerAccountId: 'y1' } } } });
    await registerAndVerify('ivan@example.test');
    expect(await prisma.user.count({ where: { email: 'ivan@example.test' } })).toBe(2);
  });

  it('forgot → reset: ответ одинаковый для любой почты, новый пароль работает, старый — нет', async () => {
    await registerAndVerify('ivan@example.test');
    const known = await post(forgot, '/api/auth/password/forgot', { email: 'ivan@example.test' });
    const unknown = await post(forgot, '/api/auth/password/forgot', { email: 'ghost@example.test' });
    expect(await known.json()).toEqual({ sent: true });
    expect(await unknown.json()).toEqual({ sent: true });
    expect(mailOutbox().filter((m) => m.kind === 'reset').map((m) => m.to)).toEqual(['ivan@example.test']);

    // Код подтверждения не годится для сброса.
    const wrongPurpose = await post(reset, '/api/auth/password/reset', { email: 'ivan@example.test', code: lastCode('ivan@example.test', 'verify'), password: 'new-password-1' });
    expect(wrongPurpose.status).toBe(400);

    const res = await post(reset, '/api/auth/password/reset', { email: 'ivan@example.test', code: lastCode('ivan@example.test', 'reset'), password: 'new-password-1' });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toBeDefined();
    expect((await post(login, '/api/auth/login', { email: 'ivan@example.test', password: PASS })).status).toBe(401);
    expect((await post(login, '/api/auth/login', { email: 'ivan@example.test', password: 'new-password-1' })).status).toBe(200);
    // Код одноразовый.
    const again = await post(reset, '/api/auth/password/reset', { email: 'ivan@example.test', code: lastCode('ivan@example.test', 'reset'), password: 'another-pass-2' });
    expect(again.status).toBe(400);
  });

  it('стенд (не localhost): кода в ответе нет даже при DEMO_LOGIN, только письмо', async () => {
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
    const res = await post(register, '/api/auth/register', { email: 'jury@example.test', password: PASS, consent: CONSENT_VERSION });
    expect(await res.json()).toEqual({ sent: true });
    expect(lastCode('jury@example.test', 'verify')).toMatch(/^\d{6}$/);
  });

  it('локальная разработка (Host localhost): код в ответе, письмо не уходит; DEVTOOLS=false — как на стенде', async () => {
    const res = await post(register, '/api/auth/register', { email: 'dev@example.test', password: PASS, consent: CONSENT_VERSION }, 'http://localhost:3000');
    const body = await res.json();
    expect(body.devCode).toMatch(/^\d{6}$/);
    expect(mailOutbox()).toHaveLength(0);
    expect((await post(verify, '/api/auth/verify', { email: 'dev@example.test', code: body.devCode }, 'http://localhost:3000')).status).toBe(200);
    // Код сброса не отдаётся и локально.
    expect(await (await post(forgot, '/api/auth/password/forgot', { email: 'dev@example.test' }, 'http://localhost:3000')).json()).toEqual({ sent: true });

    process.env.DEVTOOLS = 'false';
    resetEnvCache(); // DEVTOOLS читается через getEnv() — сбросить кэш окружения
    try {
      const off = await post(register, '/api/auth/register', { email: 'dev2@example.test', password: PASS, consent: CONSENT_VERSION }, 'http://localhost:3000');
      expect(await off.json()).toEqual({ sent: true });
    } finally {
      delete process.env.DEVTOOLS;
      resetEnvCache();
    }
  });

  it('смена пароля отзывает старые сессии: старая кука — протухшая, новая работает', async () => {
    const first = cookieFrom(await registerAndVerify('ivan@example.test'))!;
    const second = cookieFrom(await post(login, '/api/auth/login', { email: 'ivan@example.test', password: PASS }))!;
    const meOf = async (cookie: string) => (await (await me(jsonRequest(`${STAND}/api/auth/me`, 'GET', undefined, cookie))).json()).user;
    expect((await meOf(first))?.email).toBe('ivan@example.test');

    await post(forgot, '/api/auth/password/forgot', { email: 'ivan@example.test' });
    const fresh = cookieFrom(await post(reset, '/api/auth/password/reset', { email: 'ivan@example.test', code: lastCode('ivan@example.test', 'reset'), password: 'new-password-1' }))!;

    for (const old of [first, second]) {
      expect(await meOf(old)).toBeNull();
      const res = await consent(jsonRequest(`${STAND}/api/auth/consent`, 'POST', { version: CONSENT_VERSION }, old));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('session_stale');
    }
    expect((await meOf(fresh))?.email).toBe('ivan@example.test');
    expect((await consent(jsonRequest(`${STAND}/api/auth/consent`, 'POST', { version: CONSENT_VERSION }, fresh))).status).toBe(200);
  });

  it('лимит попыток входа на почту → 429', async () => {
    await registerAndVerify('ivan@example.test');
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(login, '/api/auth/login', { email: 'ivan@example.test', password: 'wrong-wrong' })).status);
    expect(codes.slice(0, 9).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('запрос с чужого Origin — 403', async () => {
    const req = new Request(`${STAND}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ email: 'a@example.test', password: PASS }),
    });
    expect((await login(req)).status).toBe(403);
  });
});
