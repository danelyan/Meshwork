// Вариант 2a в кабинете (11.10): при индексе честности high категория из теста не учитывается в подборке и в банке,
// пока её не подтвердит созвон с разбором ЭТОЙ попытки («объяснил сам»). partial / нет созвона — понижение остаётся.
import { GET as search } from '@/app/api/employer/search/route';
import { GET as matches } from '@/app/api/employer/vacancies/[id]/matches/route';
import { resetEnvCache } from '@/server/env';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const NEED = 'demo-vac-be-j-1'; // backend junior
const TPL = 'tpl-integrity-rank';
const HIGH = { level: 'high', reasons: [{ code: 'paste', group: 'browser' }, { code: 'canary_hit', group: 'fit' }], version: 'integrity-v2' };
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
      policyVersion: 'adr-0002-v4', startedAt: new Date('2026-10-10T09:50:00Z'), expiresAt: finishedAt, finishedAt, integrity,
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

type Item = { candidateId: string; categoryMatch: boolean; explanation: { category: string } };
async function vacancyItems(): Promise<Item[]> {
  const res = await matches(jsonRequest('/x', 'GET', undefined, EMP), params({ id: NEED }));
  expect(res.status).toBe(200);
  return (await res.json()).items;
}
async function bankIds(): Promise<string[]> {
  const res = await search(jsonRequest('/api/employer/search?specialization=backend&grade=junior&limit=50', 'GET', undefined, EMP));
  expect(res.status).toBe(200);
  return ((await res.json()).items as Item[]).map((i) => i.candidateId);
}

describe('индекс честности в порядке выдачи (2a, БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.deleteMany({ where: { id: { startsWith: 'demo-pool' } } });
    await prisma.taskTemplate.create({ data: { id: TPL, taskId: 't', title: 'T', specialization: 'backend', grade: 'junior', catalogIds: [], format: 'number', irtA: 1, irtB: 0 } });
    await makeCandidate('ir-low', LOW);
    await makeCandidate('ir-high', HIGH);
    await makeCandidate('ir-call', HIGH, 'explained');
    await makeCandidate('ir-partial', HIGH, 'partial');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  afterAll(() => prisma.$disconnect());

  it('подборка: high без «объяснил сам» теряет категорию, с ним — сохраняет', async () => {
    const by = new Map((await vacancyItems()).map((i) => [i.candidateId, i]));
    expect(by.get('ir-low')?.categoryMatch).toBe(true);
    expect(by.get('ir-call')?.categoryMatch).toBe(true);
    for (const id of ['ir-high', 'ir-partial']) {
      expect(by.get(id)?.categoryMatch).toBe(false);
      expect(by.get(id)?.explanation.category).toBe('категория из теста не учитывается до подтверждения на созвоне');
    }
  });

  it('банк с фильтром категории: понижённые не проходят фильтр', async () => {
    const ids = await bankIds();
    expect(ids).toEqual(expect.arrayContaining(['ir-low', 'ir-call']));
    expect(ids).not.toContain('ir-high');
    expect(ids).not.toContain('ir-partial');
  });

  it('TEST_INTEGRITY_RANKING=false — порядок без индекса', async () => {
    vi.stubEnv('TEST_INTEGRITY_RANKING', 'false');
    resetEnvCache();
    expect(await bankIds()).toEqual(expect.arrayContaining(['ir-low', 'ir-call', 'ir-high', 'ir-partial']));
    expect((await vacancyItems()).every((i) => !i.candidateId.startsWith('ir-') || i.categoryMatch)).toBe(true);
  });
});
