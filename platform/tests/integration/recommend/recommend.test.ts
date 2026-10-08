import { GET } from '@/app/api/recommendations/route';
import { explainInvitation } from '@/server/recommend/matcher';
import { gapMap } from '@/server/recommend/gap-map';
import { recommendTargets } from '@/server/recommend/targets';
import { recommendTasks } from '@/server/recommend/tasks';
import { recommendTest } from '@/server/recommend/test';
import { NO_CONFIRMED_REASON } from '@/server/recommend/types';
import { signSession } from '@/server/session';

import { seedRecommend } from '../../../prisma/seed/recommend';
import { fixtureEntries } from '../../helpers/recommend-fixtures';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

vi.mock('@/server/claims/catalog', () => ({ getCatalog: async () => fixtureEntries() }));

const DAY = 24 * 60 * 60 * 1000;

async function mkCandidate(id: string, spec: 'backend' | 'frontend' | null = 'backend') {
  await prisma.candidate.create({ data: { id, email: `${id}@example.test`, name: id, specialization: spec } });
}
async function claim(candidateId: string, catalogId: string, level: 'self_reported' | 'artifact' | 'platform' | 'third_party', status: 'confirmed' | 'proposed' | 'rejected' = 'confirmed') {
  await prisma.claimCatalog.upsert({
    where: { id: catalogId },
    update: {},
    create: { id: catalogId, specialization: 'backend', statement: catalogId, grades: ['middle'], weight: 2, proof: [], markers: [], limits: '' },
  });
  await prisma.claim.create({
    data: { candidateId, catalogId, statement: catalogId, level, quote: 'q', sourceRef: 'cv#1', sourceKind: 'resume', limits: '', suggestedProof: [], status },
  });
}

describe('recommend (БД)', () => {
  beforeEach(async () => {
    await resetDb();
    await seedRecommend(prisma);
    await mkCandidate('c1');
    await mkCandidate('c2');
  });
  afterAll(() => prisma.$disconnect());

  it('сид идемпотентен', async () => {
    await seedRecommend(prisma);
    expect(await prisma.vacancy.count()).toBe(8);
    expect(await prisma.task.count()).toBe(16);
    expect(await prisma.company.count()).toBe(3);
  });

  it('recommendTargets: без подтверждённых утверждений пусто; proposed/rejected не считаются', async () => {
    expect(await recommendTargets('c1', 5)).toEqual([]);
    await claim('c1', 'be.idempotency', 'platform', 'proposed');
    await claim('c1', 'be.transactions', 'platform', 'rejected');
    expect(await recommendTargets('c1', 5)).toEqual([]);
  });

  it('recommendTargets: ранжирование, вилка в ₽, объяснение, детерминированность', async () => {
    for (const id of ['be.idempotency', 'be.transactions', 'be.message-queue']) await claim('c1', id, 'platform');
    const a = await recommendTargets('c1', 3);
    const b = await recommendTargets('c1', 3);
    expect(a).toEqual(b);
    expect(a[0]!.vacancyId).toBe('demo-vac-be-m-1');
    expect(a[0]).toMatchObject({ covered: 3, total: 6, salaryFrom: 200000, salaryTo: 280000, companyName: 'Северный Поток' });
    expect(a[0]!.reason).toMatch(/^По вакансиям на платформе: Закрываешь 3 из 6, не хватает: /);
    expect(a.length).toBeLessThanOrEqual(3);
    expect((await recommendTargets('c1', 1))).toHaveLength(1);
  });

  it('gapMap по вакансии и по категории; чужая/пустая цель', async () => {
    await claim('c1', 'be.transactions', 'platform');
    const g = await gapMap('c1', { kind: 'vacancy', id: 'demo-vac-be-m-1' });
    expect(g.map((x) => x.catalogId)).not.toContain('be.transactions');
    expect(g).toHaveLength(5);
    const cat = await gapMap('c1', { kind: 'category', id: 'backend:middle' });
    expect(cat.length).toBeGreaterThan(0);
    await expect(gapMap('c1', { kind: 'vacancy', id: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(gapMap('c1', { kind: 'category', id: 'ops:senior' })).rejects.toMatchObject({ status: 400 });
    await expect(gapMap('ghost', { kind: 'vacancy', id: 'demo-vac-be-m-1' })).rejects.toMatchObject({ status: 404 });
  });

  it('recommendTasks: только из банка, по запрошенным пробелам', async () => {
    const out = await recommendTasks('c1', ['be.idempotency', 'be.message-queue'], 5);
    expect(out[0]!.taskId).toBe('task:delivery-semantics'); // закрывает оба
    const bank = new Set((await prisma.task.findMany()).map((t) => t.id));
    for (const t of out) expect(bank.has(t.taskId)).toBe(true);
    expect(await recommendTasks('c1', [], 5)).toEqual([]);
    expect(await recommendTasks('c1', ['be.unknown'], 5)).toEqual([]);
  });

  it('explainInvitation: объяснение по каталогу; чужое приглашение — 404', async () => {
    await claim('c1', 'be.idempotency', 'artifact');
    const inv = await prisma.invitation.create({ data: { vacancyId: 'demo-vac-be-m-1', candidateId: 'c1', salaryOffer: 250000 } });
    const cov = await explainInvitation('c1', inv.id);
    expect(cov).toMatchObject({ covered: 1, total: 6, vacancyId: 'demo-vac-be-m-1' });
    const ids = new Set(fixtureEntries().map((e) => e.id));
    for (const i of cov.items) expect(ids.has(i.catalogId)).toBe(true);
    expect(cov.explanation).toMatch(/^Закрыто 1 из 6, не хватает: /);
    await expect(explainInvitation('c2', inv.id)).rejects.toMatchObject({ status: 404 });
    await expect(explainInvitation('c1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  describe('recommendTest', () => {
    const NOW = new Date('2026-10-09T12:00:00Z');
    const strong = ['be.idempotency', 'be.transactions', 'be.message-queue', 'be.retries-timeouts', 'be.sql-indexes', 'be.rest-design', 'be.cache', 'be.authz', 'be.concurrency', 'be.integration-tests', 'be.observability', 'be.distributed-consistency', 'be.sql-schema', 'be.orm', 'be.framework', 'be.api-validation', 'be.authn-impl', 'be.config-secrets', 'be.lang-core', 'be.error-handling', 'be.background-jobs', 'common.sql-queries', 'common.http', 'common.debugging', 'common.git', 'common.security-basics', 'common.auth-flow', 'common.unit-tests'];

    it('без утверждений — Junior, разрешён, причина: подтверди карточки', async () => {
      expect(await recommendTest('c1', NOW)).toMatchObject({ specialization: 'backend', grade: 'junior', allowed: true, reason: NO_CONFIRMED_REASON });
    });

    it('черновики proposed в покрытие не идут: только confirmed/edited', async () => {
      for (const id of strong) await claim('c1', id, 'self_reported', 'proposed');
      const draft = await recommendTest('c1', NOW);
      expect(draft).toMatchObject({ grade: 'junior', reason: NO_CONFIRMED_REASON });
      await prisma.claim.updateMany({ where: { candidateId: 'c1' }, data: { status: 'confirmed' } });
      const r = await recommendTest('c1', NOW);
      expect(r.grade).toBe('middle');
      expect(r.allowed).toBe(true);
      await prisma.claim.updateMany({ where: { candidateId: 'c1' }, data: { status: 'edited' } });
      expect((await recommendTest('c1', NOW)).grade).toBe('middle');
      await prisma.claim.updateMany({ where: { candidateId: 'c1' }, data: { status: 'rejected' } });
      expect((await recommendTest('c1', NOW)).reason).toBe(NO_CONFIRMED_REASON);
    });

    it('R-C-09: смена грейда раньше 30 дней запрещена, nextAllowedAt = +30 дней; после — разрешена', async () => {
      for (const id of strong) await claim('c1', id, 'self_reported');
      const confirmedAt = new Date(NOW.getTime() - 10 * DAY);
      await prisma.candidateCategory.create({ data: { candidateId: 'c1', specialization: 'backend', grade: 'junior', confirmedAt } });
      const r = await recommendTest('c1', NOW);
      expect(r).toMatchObject({ grade: 'middle', allowed: false, nextAllowedAt: new Date(confirmedAt.getTime() + 30 * DAY).toISOString() });
      const later = await recommendTest('c1', new Date(confirmedAt.getTime() + 30 * DAY));
      expect(later.allowed).toBe(true);
      expect(later.nextAllowedAt).toBeUndefined();
    });

    it('R-C-08: подтверждённый Middle не понижается рекомендацией, пересдача того же грейда без лимита', async () => {
      await prisma.candidateCategory.create({ data: { candidateId: 'c2', specialization: 'backend', grade: 'middle', confirmedAt: new Date(NOW.getTime() - DAY) } });
      const r = await recommendTest('c2', NOW);
      expect(r).toMatchObject({ grade: 'middle', allowed: true });
      expect(r.reason).toContain('понижение не навязываем');
    });

    it('чужой/несуществующий кандидат — 404', async () => {
      await expect(recommendTest('ghost', NOW)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('GET /api/recommendations', () => {
    const cookie = (id: string) => `cid=${signSession(id)}`;

    it('без сессии — 401', async () => {
      expect((await GET(jsonRequest('/api/recommendations', 'GET'))).status).toBe(401);
    });

    it('кандидат видит тест, цели и пробелы; чужие данные не подмешиваются', async () => {
      await claim('c1', 'be.idempotency', 'platform');
      const res = await GET(jsonRequest('/api/recommendations?target=vacancy:demo-vac-be-m-1&limit=3', 'GET', undefined, cookie('c1')));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.test.grade).toBeDefined();
      expect(body.gaps.length).toBe(5);
      expect(body.targets[0].vacancyId).toBe('demo-vac-be-m-1');
      expect(Array.isArray(body.tasks)).toBe(true);
      const other = await (await GET(jsonRequest('/api/recommendations', 'GET', undefined, cookie('c2')))).json();
      expect(other.targets).toEqual([]);
      // Без target и без вакансий в целях — цель по правилу теста; пробелы только из каталога, без чужих уровней.
      expect(other.target).toBe(`category:${other.test.specialization}:${other.test.grade}`);
      expect(other.gaps.length).toBeGreaterThan(0);
      expect(other.gaps.every((g: { currentLevel: unknown }) => g.currentLevel === null)).toBe(true);
    });

    it('без target: категория из теста важнее лучшей вакансии', async () => {
      await claim('c1', 'be.idempotency', 'platform');
      const auto = await (await GET(jsonRequest('/api/recommendations', 'GET', undefined, cookie('c1')))).json();
      expect(auto.target).toBe(`vacancy:${auto.targets[0].vacancyId}`);
      await prisma.candidateCategory.create({ data: { candidateId: 'c1', specialization: 'frontend', grade: 'junior' } });
      const withCat = await (await GET(jsonRequest('/api/recommendations', 'GET', undefined, cookie('c1')))).json();
      expect(withCat.target).toBe('category:frontend:junior');
    });

    it('плохие параметры — 400, неизвестная вакансия — 404, кука несуществующего кандидата — 404', async () => {
      expect((await GET(jsonRequest('/api/recommendations?target=evil', 'GET', undefined, cookie('c1')))).status).toBe(400);
      expect((await GET(jsonRequest('/api/recommendations?limit=999', 'GET', undefined, cookie('c1')))).status).toBe(400);
      expect((await GET(jsonRequest('/api/recommendations?target=vacancy:nope', 'GET', undefined, cookie('c1')))).status).toBe(404);
      expect((await GET(jsonRequest('/api/recommendations', 'GET', undefined, cookie('ghost')))).status).toBe(404);
    });
  });
});
