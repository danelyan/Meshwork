// Кандидат и работодатель видят одно и то же (аудит 11.10, п. 4): категория, которую подборка и поиск не учитывают
// из-за индекса high (employer/integrity-ranking.ts, вариант 2a), помечена кандидату как rankingHold; созвон с разбором
// этой попытки («объяснил сам») снимает и понижение, и пометку.
import { GET as search } from '@/app/api/employer/search/route';
import { POST as confirmStartRoute } from '@/app/api/test/attempt/[id]/confirm-start/route';
import { GET as historyRoute } from '@/app/api/test/attempts/route';
import { resetEnvCache } from '@/server/env';
import { signSession, signUserSession } from '@/server/session';
import { listAttempts } from '@/server/test';
import { loadTestReview } from '@/server/call/test-review';
import { rankingHoldOf } from '@/server/test/ranking-hold';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { grantCandidateConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const cookie = (id: string) => `cid=${signSession(id)}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const TPL = 'tpl-ranking-hold';
const HIGH = { level: 'high', reasons: [{ code: 'fast_correct_series', group: 'time' }], version: 'integrity-v2' };
const LOW = { level: 'low', reasons: [], version: 'integrity-v2' };

async function makeCandidate(id: string, integrity: object, call?: 'explained' | 'partial') {
  await prisma.candidate.create({ data: { id, name: `Имя ${id}`, email: `${id}@example.test`, specialization: 'backend', consentAt: new Date() } });
  await prisma.candidateCategory.create({ data: { candidateId: id, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api' } });
  const cat = await prisma.claimCatalog.findUniqueOrThrow({ where: { id: 'be.rest-design' } });
  await prisma.claim.create({
    data: { candidateId: id, catalogId: cat.id, statement: cat.statement, level: 'self_reported', quote: 'REST API', sourceRef: 'cv.pdf#p1', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
  });
  const finishedAt = new Date('2026-10-10T10:00:00Z');
  await prisma.testAttempt.create({
    data: {
      id: `att-${id}`, candidateId: id, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api', status: 'passed', seed: 1,
      policyVersion: 'adr-0002-v7', startedAt: new Date('2026-10-10T09:50:00Z'), expiresAt: finishedAt, finishedAt, integrity,
      items: { create: [{ index: 0, templateId: TPL, instanceSeed: 1, params: {}, prompt: 'p', answerHint: '', answerKey: '1', explanation: '', answer: '1', correct: true }] },
    },
  });
  if (call) {
    await prisma.callSession.create({
      data: {
        candidateId: id, kind: 'qualifying', status: 'finished', startedAt: new Date('2026-10-10T12:00:00Z'), finishedAt: new Date('2026-10-10T12:20:00Z'), policyVersion: 'v1',
        verdictJson: { depthMap: [], evaluatedAt: '2026-10-10T12:20:00Z', summary: '', thresholdVersion: 'x', testOwnership: { status: call, reason: '', items: [{ templateId: TPL, title: 'T', correct: true }] } },
      },
    });
  }
}

async function bankIds(): Promise<string[]> {
  const res = await search(jsonRequest('/api/employer/search?specialization=backend&grade=junior&limit=50', 'GET', undefined, EMP));
  expect(res.status).toBe(200);
  return ((await res.json()).items as { candidateId: string }[]).map((i) => i.candidateId);
}

const IDS = ['rh-low', 'rh-high', 'rh-call', 'rh-partial'];

describe('rankingHold: кандидат видит то же ограничение, что действует в выдаче работодателя', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.deleteMany({ where: { id: { startsWith: 'demo-pool' } } });
    await prisma.taskTemplate.create({ data: { id: TPL, taskId: 't', title: 'T', specialization: 'backend', grade: 'junior', catalogIds: [], format: 'number', irtA: 1, irtB: 0 } });
    await makeCandidate('rh-low', LOW);
    await makeCandidate('rh-high', HIGH);
    await makeCandidate('rh-call', HIGH, 'explained');
    await makeCandidate('rh-partial', HIGH, 'partial');
    await grantCandidateConsents(IDS);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  afterAll(() => prisma.$disconnect());

  it('пометка rankingHold совпадает с исключением из поиска по грейду: high без «объяснил сам» - есть, low и explained - нет', async () => {
    const bank = await bankIds();
    const holds = Object.fromEntries(await Promise.all(IDS.map(async (id) => [id, (await rankingHoldOf(id))?.attemptId ?? null])));
    expect(holds).toEqual({ 'rh-low': null, 'rh-high': 'att-rh-high', 'rh-call': null, 'rh-partial': 'att-rh-partial' });
    for (const id of IDS) expect(bank.includes(id)).toBe(holds[id] === null);
    const summary = await listAttempts('rh-partial');
    expect(summary.map((a) => [a.id, a.rankingHold])).toEqual([['att-rh-partial', true]]);
    const viaApi = (await (await historyRoute(jsonRequest('/api/test/attempts', 'GET', undefined, cookie('rh-call')))).json()) as { attempts: { rankingHold: boolean }[] };
    expect(viaApi.attempts.map((a) => a.rankingHold)).toEqual([false]);
  });

  it('подтверждающий тест по удерживаемой попытке доступен владельцу; по неудерживаемой - 409', async () => {
    const ok = await confirmStartRoute(jsonRequest('/api/test/attempt/att-rh-high/confirm-start', 'POST', undefined, cookie('rh-high')), ctx('att-rh-high'));
    expect(ok.status).toBe(201);
    const no = await confirmStartRoute(jsonRequest('/api/test/attempt/att-rh-call/confirm-start', 'POST', undefined, cookie('rh-call')), ctx('att-rh-call'));
    expect(no.status).toBe(409);
    expect(((await no.json()) as { error: { code: string } }).error.code).toBe('confirm_not_needed');
    // Начатая подтверждающая попытка ограничение ещё не снимает.
    expect((await rankingHoldOf('rh-high'))?.attemptId).toBe('att-rh-high');
    await prisma.testAttempt.deleteMany({ where: { candidateId: 'rh-high', kind: 'confirm' } });
  });

  it('созвон разбирает попытку, которая держит категорию, а не проваленную подтверждающую', async () => {
    await prisma.taskTemplate.create({ data: { id: `${TPL}-conf`, taskId: 't2', title: 'T2', specialization: 'backend', grade: 'junior', catalogIds: [], format: 'number', irtA: 1, irtB: 0 } });
    await prisma.testAttempt.create({
      data: {
        id: 'att-rh-high-conf', candidateId: 'rh-high', specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api', status: 'not_confirmed', kind: 'confirm', confirmsAttemptId: 'att-rh-high', seed: 2,
        policyVersion: 'adr-0002-v7', startedAt: new Date('2026-10-11T09:50:00Z'), expiresAt: new Date('2026-10-11T10:00:00Z'), finishedAt: new Date('2026-10-11T10:00:00Z'), integrity: HIGH,
        items: { create: [{ index: 0, templateId: `${TPL}-conf`, instanceSeed: 1, params: {}, prompt: 'p2', answerHint: '', answerKey: '2', explanation: '', answer: '2', correct: true }] },
      },
    });
    expect((await rankingHoldOf('rh-high'))?.attemptId).toBe('att-rh-high');
    // Последняя завершённая - проваленная подтверждающая, но разбор идёт по исходной: только её «объяснил сам» снимает ограничение.
    const review = await loadTestReview('rh-high', 'backend', 'backend.web-api');
    expect(review.map((i) => [i.templateId, i.attemptId])).toEqual([[TPL, 'att-rh-high']]);
    // Созвон с вердиктом «объяснил сам» по исходной попытке снимает ограничение, даже если разобранные шаблоны есть и в
    // подтверждающей попытке (по шаблонам созвон приписался бы ей): привязка идёт по attemptId из вердикта.
    const call = await prisma.callSession.create({
      data: {
        candidateId: 'rh-high', kind: 'qualifying', status: 'finished', startedAt: new Date('2026-10-11T12:00:00Z'), finishedAt: new Date('2026-10-11T12:20:00Z'), policyVersion: 'v1',
        verdictJson: { depthMap: [], evaluatedAt: '2026-10-11T12:20:00Z', summary: '', thresholdVersion: 'x', testOwnership: { status: 'explained', reason: '', attemptId: 'att-rh-high', items: [{ templateId: `${TPL}-conf`, title: 'T2', correct: true }] } },
      },
    });
    expect(await rankingHoldOf('rh-high')).toBeNull();
    await prisma.callSession.delete({ where: { id: call.id } });
    expect((await rankingHoldOf('rh-high'))?.attemptId).toBe('att-rh-high');
    await prisma.testAttempt.deleteMany({ where: { id: 'att-rh-high-conf' } });
    await prisma.taskTemplate.deleteMany({ where: { id: `${TPL}-conf` } });
  });

  it('TEST_INTEGRITY_RANKING=false: пометки нет ни у кого, поиск показывает всех', async () => {
    vi.stubEnv('TEST_INTEGRITY_RANKING', 'false');
    resetEnvCache();
    for (const id of IDS) expect(await rankingHoldOf(id)).toBeNull();
    const bank = await bankIds();
    for (const id of IDS) expect(bank).toContain(id);
  });
});
