import { POST as login } from '@/app/api/demo/login/route';
import { GET as onboardingView } from '@/app/api/onboarding/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { resetEnvCache } from '@/server/env';
import { parseSession } from '@/server/session';

import { cookieFrom, jsonRequest } from '../../helpers/requests';
import { prisma, resetDb } from '../../helpers/db';

const post = (body: unknown) => login(jsonRequest('/api/demo/login', 'POST', body));

describe('api/demo/login: новый пользователь и сброс онбординга', () => {
  beforeEach(async () => {
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
    await resetDb();
  });
  afterEach(() => {
    delete process.env.DEMO_LOGIN;
    resetEnvCache();
  });
  afterAll(() => prisma.$disconnect());

  it('fresh без галки согласия или со старой версией – пользователь не создаётся', async () => {
    expect((await post({ fresh: true })).status).toBe(400);
    expect((await post({ fresh: true, consent: 'old-version' })).status).toBe(409);
    expect(await prisma.user.count()).toBe(0);
  });

  it('fresh: pending без onboardedAt, провайдер demo, согласие записано, чат начинается с роли; можно многократно', async () => {
    const res = await post({ fresh: true, consent: CONSENT_VERSION });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.next).toBe('/consultant');
    const cookie = cookieFrom(res)!;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id }, include: { accounts: true } });
    expect(user).toMatchObject({ role: 'pending', onboardedAt: null, isDemo: true });
    expect(user.name).toBe('Демо-гость 1');
    expect(user.accounts.map((a) => a.provider)).toEqual(['demo']);
    expect(parseSession(cookie.slice(4))).toMatchObject({ userId: user.id, role: 'pending' });

    const view = await (await onboardingView(jsonRequest('/api/onboarding', 'GET', undefined, cookie))).json();
    expect(view.current.id).toBe('role');
    expect(view.history).toEqual([]);
    expect(await prisma.consent.findMany({ where: { userId: user.id } })).toEqual([expect.objectContaining({ version: CONSENT_VERSION })]);

    const second = await (await post({ fresh: true, consent: CONSENT_VERSION })).json();
    expect(second.user.id).not.toBe(user.id);
    expect(second.user.name).toBe('Демо-гость 2');
  });

  it('restart: сбрасывает OnboardingState и onboardedAt, профиль не трогает', async () => {
    await prisma.candidate.create({ data: { id: 'demo-x', email: 'x@example.test', name: 'Икс', isDemo: true, consentAt: new Date() } });
    const first = await (await post({ candidateId: 'demo-x' })).json();
    expect(first.next).toBe('/consultant');
    const user = await prisma.user.findFirstOrThrow({ where: { candidateId: 'demo-x' } });
    await prisma.onboardingState.create({ data: { userId: user.id, answers: { consent: true } } });

    const res = await post({ restartCandidateId: 'demo-x' });
    expect(res.status).toBe(200);
    expect((await res.json()).next).toBe('/consultant');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.onboardedAt).toBeNull();
    expect(after.candidateId).toBe('demo-x');
    expect(await prisma.onboardingState.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: 'demo-x' } })).consentAt).not.toBeNull();
    // Готовый демо-кандидат считается согласившимся: перезапуск онбординга начинается не с согласия.
    expect(await prisma.consent.count({ where: { userId: user.id, version: CONSENT_VERSION } })).toBe(1);
    const view = await (await onboardingView(jsonRequest('/api/onboarding', 'GET', undefined, cookieFrom(res)!))).json();
    expect(view.current.id).not.toBe('consent');
  });

  it('restartUserId: не-демо аккаунт → 404', async () => {
    const u = await prisma.user.create({ data: { name: 'Не демо', onboardedAt: new Date() } });
    expect((await post({ restartUserId: u.id })).status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).onboardedAt).not.toBeNull();
  });

  it('без DEMO_LOGIN → 404 на оба режима, ничего не создаётся', async () => {
    process.env.DEMO_LOGIN = 'false';
    resetEnvCache();
    expect((await post({ fresh: true })).status).toBe(404);
    expect((await post({ restartUserId: 'x' })).status).toBe(404);
    expect(await prisma.user.count()).toBe(0);
  });
});
