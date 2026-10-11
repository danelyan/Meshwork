import { GET as me } from '@/app/api/auth/me/route';
import { GET as staleRoute } from '@/app/api/auth/stale/route';
import { GET as profile } from '@/app/api/profile/route';
import { resetEnvCache } from '@/server/env';
import { signSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'cid' && cookieValue ? { name: n, value: cookieValue } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { requirePageUser, requirePageCandidate, getPageSession } = await import('@/server/auth/page');

const ghost = signUserSession({ userId: 'u-gone', role: 'candidate', candidateId: 'c-gone' });

describe('протухшая кука: подпись верна, аккаунта в БД нет', () => {
  beforeEach(async () => {
    resetEnvCache();
    await resetDb();
    cookieValue = undefined;
  });
  afterAll(() => prisma.$disconnect());

  it('страница: редирект через /api/auth/stale, шапка (getPageSession) видит гостя', async () => {
    cookieValue = ghost;
    await expect(requirePageUser('/onboarding')).rejects.toThrow('REDIRECT:/api/auth/stale?next=%2Fonboarding');
    await expect(requirePageCandidate('/profile')).rejects.toThrow('REDIRECT:/api/auth/stale?next=%2Fprofile');
    expect(await getPageSession()).toBeNull();
  });

  it('API: 401 session_stale и стёртая кука; /api/auth/me – user null, не 401', async () => {
    const res = await profile(jsonRequest('/api/profile', 'GET', undefined, `cid=${ghost}`));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('session_stale');
    expect(res.headers.get('set-cookie')).toMatch(/cid=;.*Max-Age=0/);
    expect(await (await me(jsonRequest('/api/auth/me', 'GET', undefined, `cid=${ghost}`))).json()).toEqual({ user: null });
  });

  it('/api/auth/stale стирает протухшую куку и ведёт на /auth; живую не трогает', async () => {
    const res = await staleRoute(jsonRequest('/api/auth/stale?next=/onboarding', 'GET', undefined, `cid=${ghost}`));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/auth?next=%2Fonboarding');
    expect(res.headers.get('set-cookie')).toMatch(/cid=;/);
    await prisma.user.create({ data: { id: 'u-live', name: 'Жив', email: 'live@example.test' } });
    const live = signUserSession({ userId: 'u-live', role: 'pending' });
    const res2 = await staleRoute(jsonRequest('/api/auth/stale?next=/onboarding', 'GET', undefined, `cid=${live}`));
    expect(res2.headers.get('set-cookie')).toBeNull();
  });

  it('живой аккаунт и старая демо-кука с существующим кандидатом проходят', async () => {
    await prisma.user.create({ data: { id: 'u-live', name: 'Жив', email: 'live@example.test' } });
    cookieValue = signUserSession({ userId: 'u-live', role: 'pending' });
    expect((await requirePageUser('/onboarding')).userId).toBe('u-live');
    await prisma.candidate.create({ data: { id: 'demo-old', email: 'o@example.test', name: 'Старый', isDemo: true } });
    const res = await profile(jsonRequest('/api/profile', 'GET', undefined, `cid=${signSession('demo-old')}`));
    expect(res.status).toBe(200);
    // старая кука с удалённым кандидатом – протухла
    const gone = await profile(jsonRequest('/api/profile', 'GET', undefined, `cid=${signSession('nobody')}`));
    expect((await gone.json()).error.code).toBe('session_stale');
  });
});
