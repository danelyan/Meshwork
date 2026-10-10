import { POST as switchRoute } from '@/app/api/auth/role/switch/route';
import { POST as deleteAccountRoute } from '@/app/api/dev/delete-account/route';
import { POST as resetOnboardingRoute } from '@/app/api/dev/reset-onboarding/route';
import { GET as listDemo, POST as demoLogin } from '@/app/api/demo/login/route';
import { POST as onboardingRoute } from '@/app/api/onboarding/route';
import { isSessionStale } from '@/server/auth/stale';
import { resetEnvCache } from '@/server/env';
import { CANDIDATE_STEPS, EMPLOYER_STEPS } from '@/server/onboarding/scenario';
import { GET as employerVacancies } from '@/app/api/employer/vacancies/route';
import { GET as profile } from '@/app/api/profile/route';
import { recordConsent } from '@/server/auth/consent';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { switchRole } from '@/server/auth/role-switch';
import { getView } from '@/server/onboarding/service';
import { parseSession, signSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

// ADR 0004: переключение роли на одной учётке — API, вторая роль, знакомство второй роли, кука.

const URL = '/api/auth/role/switch';
const candCookie = () => `cid=${signUserSession({ userId: 'u1', role: 'candidate', candidateId: 'c1' })}`;
const post = (body: unknown, cookie?: string) => switchRoute(jsonRequest(URL, 'POST', body, cookie));

describe('POST /api/auth/role/switch', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    await prisma.candidate.create({ data: { id: 'c1', name: 'Иван', email: 'ivan@example.test' } });
    await prisma.user.create({
      data: { id: 'u1', name: 'Иван', email: 'ivan@example.test', role: 'candidate', candidateId: 'c1', onboardedAt: new Date() },
    });
    await recordConsent('u1');
  });

  it('кандидат → работодатель: создаёт профиль и компанию, запускает знакомство работодателя без согласия', async () => {
    expect((await post({ role: 'employer' }, candCookie())).status).toBe(400);

    const res = await post({ role: 'employer', companyName: 'ООО Ромашка' }, candCookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'employer', next: '/consultant', created: true, changed: true });
    const cookie = cookieFrom(res)!;
    const s = parseSession(cookie.slice(4))!;
    expect(s).toMatchObject({ userId: 'u1', role: 'employer', candidateId: null });
    expect(s.employerProfileId).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' }, include: { employerProfile: { include: { company: true } }, onboarding: true } });
    expect(user).toMatchObject({ role: 'employer', candidateId: 'c1', onboardedAt: null });
    expect(user.employerProfile!.company).toMatchObject({ name: 'ООО Ромашка', isDemo: false });
    expect(user.onboarding).toMatchObject({ stepId: null, meta: { doneRoles: ['candidate'] } });

    // Знакомство второй роли: сценарий работодателя, согласие уже есть, компания уже названа.
    const view = await getView('u1');
    expect(view.scenario).toBe('employer');
    expect(view.current.id).not.toBe('consent');
    expect(view.current.id).not.toBe('companyName');

    // Данные неактивной роли через API недоступны, своей — доступны.
    expect((await profile(jsonRequest('/api/profile', 'GET', undefined, cookie))).status).toBe(403);
    expect((await employerVacancies(jsonRequest('/api/employer/vacancies', 'GET', undefined, cookie))).status).toBe(200);
  });

  it('обратно в кандидата: профиль не создаётся, знакомство кандидата остаётся завершённым', async () => {
    const toEmp = cookieFrom(await post({ role: 'employer', companyName: 'ООО Ромашка' }, candCookie()))!;
    const res = await post({ role: 'candidate' }, toEmp);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'candidate', created: false, changed: true });
    const cookie = cookieFrom(res)!;
    expect(parseSession(cookie.slice(4))).toMatchObject({ role: 'candidate', candidateId: 'c1', employerProfileId: null });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(user.role).toBe('candidate');
    expect(user.onboardedAt).toBeInstanceOf(Date);
    expect(await prisma.candidate.count()).toBe(1);
    expect((await profile(jsonRequest('/api/profile', 'GET', undefined, cookie))).status).toBe(200);
    expect((await employerVacancies(jsonRequest('/api/employer/vacancies', 'GET', undefined, cookie))).status).toBe(403);
  });

  it('та же роль — идемпотентно: 200, changed=false, ничего не создано', async () => {
    const res = await post({ role: 'candidate' }, candCookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'candidate', created: false, changed: false });
    expect(await prisma.candidate.count()).toBe(1);
    expect(await prisma.employerProfile.count()).toBe(0);
  });

  it('работодатель → кандидат без профиля: Candidate с consentAt из согласия; занятая почта — служебная', async () => {
    await prisma.company.create({ data: { id: 'co', name: 'Компания', isDemo: false } });
    await prisma.user.create({ data: { id: 'u2', name: 'Олег', email: 'ivan@example.test', role: 'employer', onboardedAt: new Date() } });
    await prisma.employerProfile.create({ data: { id: 'e2', userId: 'u2', companyId: 'co' } });
    await recordConsent('u2');
    const res = await post({ role: 'candidate' }, `cid=${signUserSession({ userId: 'u2', role: 'employer', employerProfileId: 'e2' })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: true });
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: 'u2' }, include: { candidate: true } });
    expect(u2.candidate).toMatchObject({ email: 'user-u2@users.invalid', name: 'Олег' });
    expect(u2.candidate!.consentAt).toBeInstanceOf(Date);
    expect((await getView('u2')).scenario).toBe('candidate');
  });

  it('401 без входа; 403 старая демо-кука без аккаунта; 409 роль не выбрана; 400 плохое тело', async () => {
    expect((await post({ role: 'employer', companyName: 'ООО' })).status).toBe(401);
    const legacy = await post({ role: 'employer', companyName: 'ООО' }, `cid=${signSession('c1')}`);
    expect(legacy.status).toBe(403);
    expect((await legacy.json()).error.message).toContain('/demo');
    await prisma.user.create({ data: { id: 'u3', name: 'Новый' } });
    expect((await post({ role: 'candidate' }, `cid=${signUserSession({ userId: 'u3', role: 'pending' })}`)).status).toBe(409);
    expect((await post({ role: 'admin' }, candCookie())).status).toBe(400);
  });

  it('CSRF: чужой Origin — 403, ничего не создано', async () => {
    const res = await switchRoute(
      new Request(`http://localhost${URL}`, {
        method: 'POST',
        headers: { cookie: candCookie(), origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'employer', companyName: 'ООО' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.employerProfile.count()).toBe(0);
  });

  it('общий демо-аккаунт из сида: вторую роль не создать (403); «Новый пользователь» с /demo — можно', async () => {
    await prisma.user.update({ where: { id: 'u1' }, data: { isDemo: true } });
    expect((await post({ role: 'employer', companyName: 'ООО' }, candCookie())).status).toBe(403);
    await prisma.authAccount.create({ data: { userId: 'u1', provider: 'demo', providerAccountId: 'guest-1' } });
    expect((await post({ role: 'employer', companyName: 'ООО' }, candCookie())).status).toBe(200);
  });

  it('два одновременных перехода — один профиль и одна компания', async () => {
    const results = await Promise.all([
      switchRole('u1', { role: 'employer', companyName: 'ООО Один' }),
      switchRole('u1', { role: 'employer', companyName: 'ООО Два' }),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.employerProfile.count()).toBe(1);
    expect(await prisma.company.count()).toBe(1);
  });

  it('companyName: "" при существующем профиле работодателя — как отсутствие (200)', async () => {
    const toEmp = cookieFrom(await post({ role: 'employer', companyName: 'ООО Ромашка' }, candCookie()))!;
    const toCand = cookieFrom(await post({ role: 'candidate' }, toEmp))!;
    const res = await post({ role: 'employer', companyName: '' }, toCand);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'employer', created: false });
    // Профиля нет и название пустое — 400.
    await prisma.user.create({ data: { id: 'u4', name: 'Пётр', role: 'candidate', onboardedAt: new Date() } });
    const c4 = await prisma.candidate.create({ data: { name: 'Пётр', email: 'p@example.test' } });
    await prisma.user.update({ where: { id: 'u4' }, data: { candidateId: c4.id } });
    expect((await post({ role: 'employer', companyName: '' }, `cid=${signUserSession({ userId: 'u4', role: 'candidate', candidateId: c4.id })}`)).status).toBe(400);
  });

  it('туда-обратно с завершённым знакомством обеих ролей: у каждой роли свой итог (view.current.lead)', async () => {
    const allSkipped = [...CANDIDATE_STEPS, ...EMPLOYER_STEPS].map((st) => st.id);
    await prisma.onboardingState.create({
      data: { userId: 'u1', stepId: 'summary', skipped: allSkipped, lines: { summary: 'Итог кандидата' } },
    });
    const toEmp = cookieFrom(await post({ role: 'employer', companyName: 'ООО Ромашка' }, candCookie()))!;
    // Знакомство работодателя завершено на итоге со своей репликой.
    await prisma.onboardingState.update({ where: { userId: 'u1' }, data: { stepId: 'summary', lines: { summary: 'Итог работодателя' } } });
    await prisma.user.update({ where: { id: 'u1' }, data: { onboardedAt: new Date() } });

    const toCand = cookieFrom(await post({ role: 'candidate' }, toEmp))!;
    let view = await getView('u1');
    expect(view.current.id).toBe('summary');
    expect(view.current.lead).toBe('Итог кандидата');
    expect(view.onboarded).toBe(true);

    await post({ role: 'employer' }, toCand);
    view = await getView('u1');
    expect(view.scenario).toBe('employer');
    expect(view.current.lead).toBe('Итог работодателя');
    expect(view.onboarded).toBe(true);
  });

  it('пауза «Настроить позже» своя у каждой роли: создание второй роли не стирает паузу первой', async () => {
    await prisma.user.update({ where: { id: 'u1' }, data: { onboardedAt: null } });
    await prisma.onboardingState.create({ data: { userId: 'u1', stepId: 'grade', meta: { later: true } } });
    const toEmp = cookieFrom(await post({ role: 'employer', companyName: 'ООО Ромашка' }, candCookie()))!;
    expect((await getView('u1')).later).toBe(false);
    await post({ role: 'candidate' }, toEmp);
    const view = await getView('u1');
    expect(view.later).toBe(true);
    expect((await prisma.onboardingState.findUniqueOrThrow({ where: { userId: 'u1' } })).stepId).toBe('grade');
  });

  it('кука другого устройства в прежней роли — протухшая: API и онбординг отвечают 401 session_stale', async () => {
    const old = candCookie();
    await post({ role: 'employer', companyName: 'ООО Ромашка' }, old);
    expect(await isSessionStale(jsonRequest('/api/profile', 'GET', undefined, old))).toBe(true);
    const res = await profile(jsonRequest('/api/profile', 'GET', undefined, old));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('session_stale');
    const ob = await onboardingRoute(jsonRequest('/api/onboarding', 'POST', { action: 'skip', stepId: 'inn' }, old));
    expect(ob.status).toBe(401);
  });
});

describe('демо: личные аккаунты «Нового пользователя» не попадают в общие списки (ADR 0004)', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
    await prisma.company.create({ data: { id: 'demo-co', name: 'Демо-компания' } });
    await prisma.user.create({ data: { id: 'shared-emp', name: 'Общий работодатель', role: 'employer', isDemo: true, onboardedAt: new Date() } });
    await prisma.employerProfile.create({ data: { userId: 'shared-emp', companyId: 'demo-co' } });
    // Гость «Нового пользователя»: кандидат, ставший работодателем.
    const c = await prisma.candidate.create({ data: { name: 'Гость', email: 'guest@example.test' } });
    await prisma.user.create({
      data: {
        id: 'guest',
        name: 'Демо-гость 1',
        role: 'candidate',
        isDemo: true,
        candidateId: c.id,
        onboardedAt: new Date(),
        accounts: { create: { provider: 'demo', providerAccountId: 'g-1' } },
      },
    });
    await switchRole('guest', { role: 'employer', companyName: 'ООО Гость' });
  });

  it('GET-список работодателей — только общие сид-аккаунты', async () => {
    const body = await (await listDemo()).json();
    expect(body.employers.map((e: { id: string }) => e.id)).toEqual(['shared-emp']);
  });

  it('вход по employerUserId и «пройти заново» по restartUserId гостя — 404', async () => {
    expect((await demoLogin(jsonRequest('/api/demo/login', 'POST', { employerUserId: 'guest' }))).status).toBe(404);
    expect((await demoLogin(jsonRequest('/api/demo/login', 'POST', { restartUserId: 'guest' }))).status).toBe(404);
    expect((await demoLogin(jsonRequest('/api/demo/login', 'POST', { employerUserId: 'shared-emp' }))).status).toBe(200);
  });
});

describe('дебаг-панель и учётка с двумя профилями', () => {
  afterAll(() => prisma.$disconnect());
  const dev = (path: string, body: unknown, cookie: string) =>
    new Request(`http://localhost:3016${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3016', cookie },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    await prisma.candidate.create({ data: { id: 'c1', name: 'Иван', email: 'ivan@example.test' } });
    await prisma.user.create({ data: { id: 'u1', name: 'Иван', role: 'candidate', candidateId: 'c1', onboardedAt: new Date() } });
    await recordConsent('u1');
    await prisma.candidateProfile.create({ data: { candidateId: 'c1', city: 'Казань' } });
  });

  it('удаление учётки удаляет оба профиля и компанию', async () => {
    const res = await switchRoute(jsonRequest(URL, 'POST', { role: 'employer', companyName: 'ООО Ромашка' }, candCookie()));
    const emp = cookieFrom(res)!;
    expect((await deleteAccountRoute(dev('/api/dev/delete-account', {}, emp))).status).toBe(200);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.candidate.count()).toBe(0);
    expect(await prisma.employerProfile.count()).toBe(0);
    expect(await prisma.company.count()).toBe(0);
  });

  it('сброс знакомства с профилем — только активной роли', async () => {
    const emp = cookieFrom(await switchRoute(jsonRequest(URL, 'POST', { role: 'employer', companyName: 'ООО Ромашка' }, candCookie())))!;
    await prisma.company.updateMany({ data: { industry: 'Финтех' } });
    expect((await resetOnboardingRoute(dev('/api/dev/reset-onboarding', { alsoProfile: true }, emp))).status).toBe(200);
    expect((await prisma.company.findFirstOrThrow()).industry).toBeNull();
    expect(await prisma.candidateProfile.findUnique({ where: { candidateId: 'c1' } })).toMatchObject({ city: 'Казань' });
    expect(await prisma.candidate.count()).toBe(1);
  });
});
