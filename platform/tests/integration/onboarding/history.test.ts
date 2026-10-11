// Журнал редакций ответов опроса (C05, аудит 11.10): запись на каждое изменение, ничего - на повтор того же
// значения, сброс пишет стёртые ответы, выдача только своя и только кандидату, удаление аккаунта уносит журнал.
import { GET as history } from '@/app/api/onboarding/history/route';
import { POST } from '@/app/api/onboarding/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { clearOnboarding } from '@/server/devtools/actions';
import type { OnboardingView } from '@/server/onboarding/types';
import { parseSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const pending = (userId: string) => `cid=${signUserSession({ userId, role: 'pending' })}`;

async function act(cookie: string, body: unknown) {
  const res = await POST(jsonRequest('/api/onboarding', 'POST', body, cookie));
  return { res, status: res.status, json: (await res.json()) as OnboardingView };
}

async function asCandidate(userId: string): Promise<string> {
  let c = pending(userId);
  expect((await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } })).status).toBe(200);
  const r = await act(c, { action: 'answer', stepId: 'role', value: 'candidate' });
  expect(r.status).toBe(200);
  c = cookieFrom(r.res)!;
  expect((await act(c, { action: 'answer', stepId: 'candidateConsents', value: [] })).status).toBe(200);
  return c;
}

async function revisions(cookie: string) {
  const res = await history(jsonRequest('/api/onboarding/history', 'GET', undefined, cookie));
  return { status: res.status, revisions: ((await res.json()) as { revisions?: { stepId: string; label: string; previous: string | null; value: string | null; source: string }[] }).revisions ?? [] };
}

describe('GET /api/onboarding/history', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({ data: { id: 'u1', name: 'Иван Петров', email: 'ivan@example.test' } });
    await prisma.user.create({ data: { id: 'u2', name: 'Пётр', email: 'petr@example.test' } });
  });

  it('пишет «было → стало» на изменение, молчит на то же значение; без входа 401, pending 403; чужие записи не видны', async () => {
    const c = await asCandidate('u1');
    expect((await history(jsonRequest('/api/onboarding/history', 'GET'))).status).toBe(401);
    expect((await history(jsonRequest('/api/onboarding/history', 'GET', undefined, pending('u2')))).status).toBe(403);

    const start = await prisma.onboardingAnswerRevision.count({ where: { userId: 'u1' } });
    expect(start).toBeGreaterThanOrEqual(3); // согласие, роль, согласия кандидата
    await act(c, { action: 'answer', stepId: 'goal', value: 'job_search' });
    await act(c, { action: 'goto', stepId: 'goal' });
    await act(c, { action: 'answer', stepId: 'goal', value: 'job_search' });
    expect(await prisma.onboardingAnswerRevision.count({ where: { userId: 'u1', stepId: 'goal' } })).toBe(1);
    await act(c, { action: 'goto', stepId: 'goal' });
    await act(c, { action: 'answer', stepId: 'goal', value: 'grade_confirm' });

    const mine = await revisions(c);
    expect(mine.status).toBe(200);
    const goal = mine.revisions.filter((r) => r.stepId === 'goal');
    expect(goal).toEqual([
      expect.objectContaining({ label: 'Цель', previous: 'Ищу работу', value: 'Хочу подтвердить грейд', source: 'user' }),
      expect.objectContaining({ label: 'Цель', previous: null, value: 'Ищу работу', source: 'user' }),
    ]);
    expect(mine.revisions.every((r) => typeof r.label === 'string')).toBe(true);

    const other = await asCandidate('u2');
    expect((await revisions(other)).revisions.some((r) => r.stepId === 'goal')).toBe(false);
  });

  it('сброс опроса пишет стёртые ответы с источником reset; удаление аккаунта уносит журнал', async () => {
    const c = await asCandidate('u1');
    await act(c, { action: 'answer', stepId: 'goal', value: 'market_watch' });
    const s = parseSession(c.replace(/^cid=/, ''))!;
    await clearOnboarding({ ...s, userId: 'u1' }, false);
    const after = await revisions(c);
    expect(after.revisions[0]).toMatchObject({ stepId: expect.any(String), value: null, source: 'reset' });
    expect(after.revisions.filter((r) => r.source === 'reset').map((r) => r.stepId)).toContain('goal');
    await prisma.user.delete({ where: { id: 'u1' } });
    expect(await prisma.onboardingAnswerRevision.count({ where: { userId: 'u1' } })).toBe(0);
  });
});
