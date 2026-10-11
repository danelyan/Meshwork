// Вариант 2a в кабинете (11.10): при индексе честности high категория из теста не учитывается в подборке и в банке,
// пока её не подтвердит созвон с разбором ЭТОЙ попытки («объяснил сам»). partial / нет созвона — понижение остаётся.
import { GET as search } from '@/app/api/employer/search/route';
import { GET as matches } from '@/app/api/employer/vacancies/[id]/matches/route';
import { CATEGORY_WITHHELD_TEXT } from '@/server/employer/ranking';
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

type Item = { candidateId: string; categoryMatch: boolean; explanation: { category: string }; candidate: { category: { label: string; withheld?: true } | null } };
async function vacancyItems(query = ''): Promise<Item[]> {
  const res = await matches(jsonRequest(`/x?${query}`, 'GET', undefined, EMP), params({ id: NEED }));
  expect(res.status).toBe(200);
  return (await res.json()).items;
}
async function bankIds(query = ''): Promise<string[]> {
  const res = await search(jsonRequest(`/api/employer/search?specialization=backend&grade=junior&limit=50&${query}`, 'GET', undefined, EMP));
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

  it('подборка: high без «объяснил сам» теряет категорию (виден только в расширенном пуле, карточка помечена), с ним — сохраняет', async () => {
    const main = new Map((await vacancyItems()).map((i) => [i.candidateId, i]));
    expect(main.get('ir-low')?.categoryMatch).toBe(true);
    expect(main.get('ir-call')?.categoryMatch).toBe(true);
    expect(main.get('ir-call')?.candidate.category).toEqual({ specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api', label: 'Backend · Junior' });
    // основной режим — только учитываемые категории: не подтверждённый high в подборке отсутствует
    expect(main.has('ir-high')).toBe(false);
    expect(main.has('ir-partial')).toBe(false);
    const by = new Map((await vacancyItems('pool=all')).map((i) => [i.candidateId, i]));
    for (const id of ['ir-high', 'ir-partial']) {
      expect(by.get(id)?.categoryMatch).toBe(false);
      expect(by.get(id)?.explanation.category).toBe(CATEGORY_WITHHELD_TEXT);
      // карточка говорит то же, что объяснение: категория есть, но не учитывается
      expect(by.get(id)?.candidate.category).toMatchObject({ grade: 'junior', label: 'Backend · Junior (не учитывается до подтверждения)', withheld: true });
    }
    expect(by.get('ir-call')?.candidate.category?.withheld).toBeUndefined();
  });

  it('банк с фильтром категории: понижённые не проходят фильтр даже в расширенном пуле', async () => {
    for (const q of ['', 'pool=all']) {
      const ids = await bankIds(q);
      expect(ids).toEqual(expect.arrayContaining(['ir-low', 'ir-call']));
      expect(ids).not.toContain('ir-high');
      expect(ids).not.toContain('ir-partial');
    }
  });

  it('TEST_INTEGRITY_RANKING=false — порядок без индекса', async () => {
    vi.stubEnv('TEST_INTEGRITY_RANKING', 'false');
    resetEnvCache();
    expect(await bankIds()).toEqual(expect.arrayContaining(['ir-low', 'ir-call', 'ir-high', 'ir-partial']));
    expect((await vacancyItems()).every((i) => !i.candidateId.startsWith('ir-') || i.categoryMatch)).toBe(true);
  });
});
