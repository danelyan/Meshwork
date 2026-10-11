import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as answerless, POST as expertStart } from '@/app/api/expert/start/route';
import { GET as expertGet } from '@/app/api/expert/attempt/[id]/route';
import { POST as expertAnswer } from '@/app/api/expert/attempt/[id]/answer/route';
import { POST as expertFinish } from '@/app/api/expert/attempt/[id]/finish/route';
import { GET as candidateHistory } from '@/app/api/test/attempts/route';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { loadPool } from '@/server/employer/matching';
import { resetEnvCache } from '@/server/env';
import { EXPERT_COOKIE, EXPERT_DAILY_CAP, EXPERT_EMAIL_SUFFIX, EXPERT_RATE_PER_CLIENT } from '@/server/expert';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const BODY = { specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'middle' } as const;

function startReq(ip = '10.0.0.1', body: unknown = BODY): Request {
  const r = jsonRequest('/api/expert/start', 'POST', body);
  r.headers.set('x-forwarded-for', ip);
  return r;
}

async function start(ip?: string): Promise<{ attemptId: string; cookie: string; candidateId: string }> {
  const res = await expertStart(startReq(ip));
  expect(res.status).toBe(201);
  const { attemptId } = (await res.json()) as { attemptId: string };
  const cookie = cookieFrom(res, EXPERT_COOKIE)!;
  expect(cookie).toBeTruthy();
  const a = await prisma.testAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return { attemptId, cookie, candidateId: a.candidateId };
}

async function currentKey(attemptId: string): Promise<string> {
  const it = await prisma.testItem.findFirstOrThrow({ where: { attemptId, correct: null } });
  return it.answerKey.split('|')[0]!;
}

describe('режим эксперта (/api/expert)', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    vi.stubEnv('DEMO_LOGIN', 'true');
    vi.stubEnv('TEST_INTEGRITY', 'false'); // мгновенные ответы иначе дают high → needs_confirmation, категория не пишется и так
    resetEnvCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('флаг DEMO_LOGIN выключен → 404 на всех маршрутах', async () => {
    vi.stubEnv('DEMO_LOGIN', 'false');
    resetEnvCache();
    expect((await answerless()).status).toBe(404);
    expect((await expertStart(startReq())).status).toBe(404);
    expect((await expertGet(jsonRequest('/api/expert/attempt/x', 'GET'), ctx('x'))).status).toBe(404);
    expect(await prisma.candidate.count()).toBe(0);
  });

  it('эксперт проходит настоящий тест; итог - разбор, категория не пишется, в пул работодателя не попадает', async () => {
    const { attemptId, cookie, candidateId } = await start();
    const cand = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId }, include: { user: { include: { accounts: true } } } });
    expect(cand.email.endsWith(EXPERT_EMAIL_SUFFIX)).toBe(true);
    expect(cand.hiddenFromEmployers).toBe(true);
    expect(cand.isDemo).toBe(false);
    expect(cand.user?.accounts.map((a) => a.provider)).toEqual(['expert']);

    let body = (await (await expertGet(jsonRequest(`/api/expert/attempt/${attemptId}`, 'GET', undefined, cookie), ctx(attemptId))).json()) as {
      attempt: { status: string; result: unknown };
      outcome: { wouldGrant: string | null; theta: number; se: number } | null;
    };
    expect(body.attempt.status).toBe('active');
    let n = 0;
    while (body.attempt.status === 'active' && n++ < 20) {
      const key = await currentKey(attemptId);
      const res = await expertAnswer(jsonRequest(`/api/expert/attempt/${attemptId}/answer`, 'POST', { answer: key }, cookie), ctx(attemptId));
      expect(res.status).toBe(200);
      body = await res.json();
    }
    expect(body.attempt.status).toBe('passed');
    expect(body.outcome).toMatchObject({ wouldGrant: 'middle' });
    expect(Number.isFinite(body.outcome!.theta)).toBe(true);
    expect(body.outcome!.se).toBeGreaterThan(0);
    // Сервис теста записал категорию при итоге — режим эксперта её убрал.
    expect(await prisma.candidateCategory.count({ where: { candidateId } })).toBe(0);
    // Даже если бы категория и видимость появились — пул поиска и подборки эксперта не берёт.
    await prisma.candidate.update({ where: { id: candidateId }, data: { hiddenFromEmployers: false } });
    await prisma.candidateCategory.create({ data: { candidateId, specialization: 'backend', grade: 'middle', source: 'test' } });
    await prisma.candidate.create({ data: { id: 'real', email: 'real@example.test', name: 'Реальный', categories: { create: { specialization: 'backend', grade: 'middle', source: 'test' } } } });
    const pool = await loadPool(new Map());
    expect(pool.map((p) => p.evidence.id)).toEqual(['real']);
  });

  it('досрочный итог тоже без категории; чужую попытку эксперт не видит; кука эксперта не открывает API кандидата', async () => {
    const a = await start('10.0.0.2');
    const b = await start('10.0.0.3');
    expect((await expertGet(jsonRequest(`/api/expert/attempt/${b.attemptId}`, 'GET', undefined, a.cookie), ctx(b.attemptId))).status).toBe(404);
    expect((await expertGet(jsonRequest(`/api/expert/attempt/${a.attemptId}`, 'GET'), ctx(a.attemptId))).status).toBe(401);
    // Значение куки эксперта, подставленное как сессия кандидата, не принимается.
    const asCid = `cid=${a.cookie.split('=')[1]}`;
    expect((await candidateHistory(jsonRequest('/api/test/attempts', 'GET', undefined, asCid))).status).toBe(401);

    const key = await currentKey(a.attemptId);
    await expertAnswer(jsonRequest(`/api/expert/attempt/${a.attemptId}/answer`, 'POST', { answer: key }, a.cookie), ctx(a.attemptId));
    const fin = await expertFinish(jsonRequest(`/api/expert/attempt/${a.attemptId}/finish`, 'POST', undefined, a.cookie), ctx(a.attemptId));
    expect(fin.status).toBe(200);
    expect(((await fin.json()) as { attempt: { status: string } }).attempt.status).not.toBe('active');
    expect(await prisma.candidateCategory.count({ where: { candidateId: a.candidateId } })).toBe(0);
  });

  it('неверный выбор не создаёт эксперта (422)', async () => {
    const res = await expertStart(startReq('10.0.0.9', { ...BODY, subcategoryId: 'frontend.web' }));
    expect(res.status).toBe(422);
    expect(await prisma.candidate.count()).toBe(0);
  });

  it('лимит на адрес клиента → 429', async () => {
    for (let i = 0; i < EXPERT_RATE_PER_CLIENT.limit; i++) expect((await expertStart(startReq('10.0.0.5'))).status).toBe(201);
    expect((await expertStart(startReq('10.0.0.5'))).status).toBe(429);
    expect((await expertStart(startReq('10.0.0.6'))).status).toBe(201);
  });

  it('суточный потолок → 429; эксперты старше суток удаляются при создании нового', async () => {
    const old = new Date(Date.now() - 2 * 24 * 3600_000);
    await prisma.candidate.create({ data: { id: 'old-exp', email: `old${EXPERT_EMAIL_SUFFIX}`, name: 'x', hiddenFromEmployers: true, createdAt: old } });
    await prisma.candidate.createMany({
      data: Array.from({ length: EXPERT_DAILY_CAP }, (_, i) => ({ email: `e${i}${EXPERT_EMAIL_SUFFIX}`, name: 'x', hiddenFromEmployers: true })),
    });
    expect((await expertStart(startReq('10.0.0.7'))).status).toBe(429);
    expect(await prisma.candidate.findUnique({ where: { id: 'old-exp' } })).toBeNull();
    await prisma.candidate.deleteMany({ where: { email: { startsWith: 'e' }, NOT: { id: 'old-exp' } } });
    expect((await expertStart(startReq('10.0.0.8'))).status).toBe(201);
  });
});
