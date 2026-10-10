import { POST as switchRoute } from '@/app/api/auth/role/switch/route';
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
});
