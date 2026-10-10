import { resetEnvCache } from '@/server/env';
import { POST as consent } from '@/app/api/auth/consent/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as complete } from '@/app/api/auth/onboarding/complete/route';
import { POST as role } from '@/app/api/auth/role/route';
import { GET as listDemo, POST as demoLogin } from '@/app/api/demo/login/route';
import { CONSENT_VERSION, recordConsent } from '@/server/auth/consent';
import { GET as consultantConversations } from '@/app/api/consultant/conversations/route';
import { GET as employerInvitations } from '@/app/api/employer/invitations/route';
import { GET as employerVacancies } from '@/app/api/employer/vacancies/route';
import { GET as health } from '@/app/api/health/route';
import { GET as candidateInvitations } from '@/app/api/invitations/route';
import { GET as onboardingState } from '@/app/api/onboarding/route';
import { GET as profile } from '@/app/api/profile/route';
import { POST as stt } from '@/app/api/stt/route';
import { GET as testAttempts } from '@/app/api/test/attempts/route';
import { parseSession, requireCandidate, requireEmployer, signSession, signUserSession } from '@/server/session';

import { seedAuth } from '../../../prisma/seed/auth';
import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const userCookie = (userId: string) => `cid=${signUserSession({ userId, role: 'pending' })}`;

describe('аккаунт: роль, согласие, онбординг', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({ data: { id: 'u-new', name: 'Новый', email: 'new@example.test' } });
  });

  it('me: pending, не онбордирован, без согласия; без входа — user null', async () => {
    const res = await me(jsonRequest('/api/auth/me', 'GET', undefined, userCookie('u-new')));
    expect((await res.json()).user).toMatchObject({ id: 'u-new', role: 'pending', onboarded: false, consent: false });
    expect(await (await me(jsonRequest('/api/auth/me', 'GET'))).json()).toEqual({ user: null });
  });

  it('согласие: фиксируется версия и время; устаревшая версия — 409; без входа — 401', async () => {
    const ok = await consent(jsonRequest('/api/auth/consent', 'POST', { version: CONSENT_VERSION }, userCookie('u-new')));
    expect(ok.status).toBe(200);
    const rows = await prisma.consent.findMany({ where: { userId: 'u-new' } });
    expect(rows).toEqual([expect.objectContaining({ version: CONSENT_VERSION, acceptedAt: expect.any(Date) })]);
    expect((await consent(jsonRequest('/api/auth/consent', 'POST', { version: 'old' }, userCookie('u-new')))).status).toBe(409);
    expect((await consent(jsonRequest('/api/auth/consent', 'POST', { version: CONSENT_VERSION }))).status).toBe(401);
  });

  it('роль candidate: создаёт Candidate (consentAt из согласия), перевыпускает куку; второй раз — 409', async () => {
    await recordConsent('u-new');
    const res = await role(jsonRequest('/api/auth/role', 'POST', { role: 'candidate' }, userCookie('u-new')));
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res)!;
    const candidateId = requireCandidate(jsonRequest('/x', 'GET', undefined, cookie));
    const cand = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    expect(cand).toMatchObject({ email: 'new@example.test', name: 'Новый' });
    expect(cand.consentAt).toBeInstanceOf(Date);
    expect((await role(jsonRequest('/api/auth/role', 'POST', { role: 'employer', companyName: 'ООО' }, cookie))).status).toBe(409);
  });

  it('роль candidate без почты или с занятой почтой → служебный адрес', async () => {
    await prisma.candidate.create({ data: { name: 'Занял', email: 'new@example.test' } });
    const res = await role(jsonRequest('/api/auth/role', 'POST', { role: 'candidate' }, userCookie('u-new')));
    const id = parseSession(cookieFrom(res)!.slice(4))!.candidateId!;
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id } })).email).toBe('user-u-new@users.invalid');
  });

  it('роль employer: новая компания, requireEmployer проходит, requireCandidate — 403', async () => {
    const res = await role(jsonRequest('/api/auth/role', 'POST', { role: 'employer', companyName: 'ООО Ромашка' }, userCookie('u-new')));
    const cookie = cookieFrom(res)!;
    const { employerProfileId } = requireEmployer(jsonRequest('/x', 'GET', undefined, cookie));
    const p = await prisma.employerProfile.findUniqueOrThrow({ where: { id: employerProfileId }, include: { company: true } });
    expect(p.company).toMatchObject({ name: 'ООО Ромашка', isDemo: false });
    expect(() => requireCandidate(jsonRequest('/x', 'GET', undefined, cookie))).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('завершение онбординга: без роли/согласия — 409, затем next по роли', async () => {
    const c = userCookie('u-new');
    expect((await complete(jsonRequest('/x', 'POST', {}, c))).status).toBe(409);
    const roled = cookieFrom(await role(jsonRequest('/x', 'POST', { role: 'candidate' }, c)))!;
    expect((await complete(jsonRequest('/x', 'POST', {}, roled))).status).toBe(409);
    await recordConsent('u-new');
    const done = await complete(jsonRequest('/x', 'POST', {}, roled));
    expect(await done.json()).toEqual({ onboarded: true, next: '/consultant' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'u-new' } })).onboardedAt).toBeInstanceOf(Date);
  });

  it('CSRF: POST с чужим Origin — 403', async () => {
    const req = new Request('http://localhost/api/auth/role', {
      method: 'POST',
      headers: { cookie: userCookie('u-new'), origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'candidate' }),
    });
    expect((await role(req)).status).toBe(403);
    expect((await logout(new Request('http://localhost/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example' } }))).status).toBe(403);
  });

  it('logout: стирает куку; форма (Accept: text/html) → 303 на /auth', async () => {
    const res = await logout(jsonRequest('/api/auth/logout', 'POST', {}));
    expect(res.headers.get('set-cookie')).toMatch(/cid=;.*Max-Age=0/i);
    const form = await logout(new Request('http://localhost/api/auth/logout', { method: 'POST', headers: { accept: 'text/html' } }));
    expect(form.status).toBe(303);
    expect(new URL(form.headers.get('location')!).pathname).toBe('/auth');
  });
});

describe('демо-вход: кандидаты и работодатель', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    await prisma.candidate.create({ data: { id: 'demo-a', email: 'demo-a@example.test', name: 'Демо А', isDemo: true } });
    await prisma.company.create({ data: { id: 'demo-co-northstream', name: 'Нордстрим (демо)' } });
    await seedAuth(prisma);
  });

  it('без DEMO_LOGIN список и вход отвечают 404', async () => {
    process.env.DEMO_LOGIN = 'false';
    resetEnvCache();
    try {
      expect((await listDemo()).status).toBe(404);
      expect((await demoLogin(jsonRequest('/api/demo/login', 'POST', { candidateId: 'demo-a' }))).status).toBe(404);
    } finally {
      process.env.DEMO_LOGIN = 'true';
      resetEnvCache();
    }
  });

  it('GET отдаёт и кандидатов, и работодателей с компанией', async () => {
    const body = await (await listDemo()).json();
    expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(['demo-a']);
    expect(body.employers).toEqual([{ id: 'demo-employer', name: expect.any(String), company: { id: 'demo-co-northstream', name: 'Нордстрим (демо)' } }]);
  });

  it('вход за кандидата создаёт аккаунт один раз; кука аккаунта', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await demoLogin(jsonRequest('/api/demo/login', 'POST', { candidateId: 'demo-a' }));
      expect(parseSession(cookieFrom(res)!.slice(4))).toMatchObject({ role: 'candidate', candidateId: 'demo-a', userId: expect.any(String) });
    }
    expect(await prisma.user.count({ where: { candidateId: 'demo-a', isDemo: true, role: 'candidate' } })).toBe(1);
  });

  it('вход за работодателя → requireEmployer; не-демо работодатель — 404', async () => {
    const res = await demoLogin(jsonRequest('/api/demo/login', 'POST', { employerUserId: 'demo-employer' }));
    expect(await res.json()).toMatchObject({ next: '/consultant' });
    expect(requireEmployer(jsonRequest('/x', 'GET', undefined, cookieFrom(res)))).toEqual({ userId: 'demo-employer', employerProfileId: 'demo-employer-northstream' });
    await prisma.user.update({ where: { id: 'demo-employer' }, data: { isDemo: false } });
    expect((await demoLogin(jsonRequest('/api/demo/login', 'POST', { employerUserId: 'demo-employer' }))).status).toBe(404);
  });
});

// Матрица API (E-05, фаза 1; R-N-07, R-C-16, R-E-07): по запросу от каждой роли в каждую группу API.
// Группы и уровни — `API_ACCESS` в src/server/auth/access.ts. «пускает» = гвард пройден (не 401/403 и не 5xx):
// дальше обработчик может ответить 400/404 по своим причинам (например, распознавание речи выключено).
describe('матрица API: роль × группа → 401/403/пускает', () => {
  afterAll(() => prisma.$disconnect());
  beforeAll(async () => {
    await resetDb();
    await prisma.candidate.create({ data: { id: 'm-cand', email: 'm-cand@example.test', name: 'Кандидат' } });
    await prisma.company.create({ data: { id: 'm-co', name: 'ООО Матрица', isDemo: false } });
    await prisma.user.create({ data: { id: 'm-u-pending', name: 'Без роли' } });
    await prisma.user.create({ data: { id: 'm-u-cand', name: 'Кандидат', role: 'candidate', candidateId: 'm-cand' } });
    await prisma.user.create({ data: { id: 'm-u-emp', name: 'Работодатель', role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: 'm-emp', userId: 'm-u-emp', companyId: 'm-co' } });
  });

  const cid = (token: string) => `cid=${token}`;
  type Who = 'guest' | 'stale' | 'pending' | 'candidate' | 'legacy' | 'employer' | 'bothAsCandidate' | 'bothAsEmployer';
  const COOKIES: Record<Who, () => string | undefined> = {
    guest: () => undefined,
    // Подпись верна, аккаунта в БД нет.
    stale: () => cid(signUserSession({ userId: 'm-u-gone', role: 'candidate', candidateId: 'm-cand' })),
    pending: () => cid(signUserSession({ userId: 'm-u-pending', role: 'pending' })),
    candidate: () => cid(signUserSession({ userId: 'm-u-cand', role: 'candidate', candidateId: 'm-cand' })),
    legacy: () => cid(signSession('m-cand')),
    employer: () => cid(signUserSession({ userId: 'm-u-emp', role: 'employer', employerProfileId: 'm-emp' })),
    // Кука с обоими профилями (будущее переключение ролей): пускает только активная роль.
    bothAsCandidate: () => cid(signUserSession({ userId: 'm-u-cand', role: 'candidate', candidateId: 'm-cand', employerProfileId: 'm-emp' })),
    bothAsEmployer: () => cid(signUserSession({ userId: 'm-u-emp', role: 'employer', candidateId: 'm-cand', employerProfileId: 'm-emp' })),
  };

  type Call = (cookie: string | undefined) => Promise<Response>;
  const get = (path: string, h: (req: Request) => Promise<Response>): Call => (c) => h(jsonRequest(path, 'GET', undefined, c));
  const GROUPS: Record<string, { calls: Call[]; expect: Record<Who, 401 | 403 | 'ok'> }> = {
    'public (/api/health)': {
      calls: [get('/api/health', health as (req: Request) => Promise<Response>)],
      expect: { guest: 'ok', stale: 'ok', pending: 'ok', candidate: 'ok', legacy: 'ok', employer: 'ok', bothAsCandidate: 'ok', bothAsEmployer: 'ok' },
    },
    'account (/api/onboarding)': {
      calls: [get('/api/onboarding', onboardingState)],
      expect: { guest: 401, stale: 401, pending: 'ok', candidate: 'ok', legacy: 401, employer: 'ok', bothAsCandidate: 'ok', bothAsEmployer: 'ok' },
    },
    'candidate (profile, test, invitations, consultant)': {
      calls: [
        get('/api/profile', profile),
        get('/api/test/attempts', testAttempts),
        get('/api/invitations', candidateInvitations),
        get('/api/consultant/conversations', consultantConversations),
      ],
      expect: { guest: 401, stale: 401, pending: 403, candidate: 'ok', legacy: 'ok', employer: 403, bothAsCandidate: 'ok', bothAsEmployer: 403 },
    },
    'employer (vacancies, invitations)': {
      calls: [get('/api/employer/vacancies', employerVacancies), get('/api/employer/invitations', employerInvitations)],
      expect: { guest: 401, stale: 401, pending: 403, candidate: 403, legacy: 403, employer: 'ok', bothAsCandidate: 403, bothAsEmployer: 'ok' },
    },
    'session (POST /api/stt)': {
      calls: [(c) => stt(new Request('http://localhost/api/stt', { method: 'POST', headers: c ? { cookie: c } : {}, body: new Uint8Array(2) }))],
      expect: { guest: 401, stale: 401, pending: 'ok', candidate: 'ok', legacy: 'ok', employer: 'ok', bothAsCandidate: 'ok', bothAsEmployer: 'ok' },
    },
  };

  const cases = Object.entries(GROUPS).flatMap(([group, g]) => (Object.keys(g.expect) as Who[]).map((who) => [group, who, g.expect[who]] as const));
  it.each(cases)('%s · %s → %s', async (group, who, want) => {
    for (const call of GROUPS[group]!.calls) {
      const res = await call(COOKIES[who]());
      if (want === 'ok') {
        expect([401, 403], `${res.status}`).not.toContain(res.status);
        expect(res.status).toBeLessThan(500);
      } else {
        expect(res.status).toBe(want);
      }
    }
  });
});
