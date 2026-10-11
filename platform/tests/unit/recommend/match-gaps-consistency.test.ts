// Согласованность «Моей карты» (/career, совпадение с вакансией) и «Карты пробелов» (/skills):
// одно требование не может быть «закрыто» в совпадении и «Сейчас: Нет» в карте пробелов.
import { withCategory } from '@/server/recommend/career';
import { buildIndex } from '@/server/recommend/evidence';
import { categoryNeeds, computeGaps } from '@/server/recommend/gap-map';
import { computeCoverage } from '@/server/recommend/matcher';
import type { CatalogEntry, EvidenceLevel } from '@/server/claims/types';

vi.mock('@/server/db', () => ({ prisma: {} }));

const be = (id: string, junior: number | null, adjacent: string[] = []): CatalogEntry => ({
  id, specialization: 'backend', statement: `S:${id}`, grades: ['junior', 'middle'], weight: 2, proof: ['artifact'],
  markers: [], limits: '', weights: { junior, middle: 2, senior: 2 }, stack: null, adjacent,
} as unknown as CatalogEntry);
const common = (id: string, junior: number): CatalogEntry => ({
  ...be(id, null), specialization: 'common', weights: { backend: { junior, middle: 2, senior: 2 }, frontend: { junior: 1, middle: 1, senior: 1 } },
} as unknown as CatalogEntry);

// Срез реального каталога backend:junior: шесть требований вакансии «Гранит Софт — Backend (Junior)» + то,
// что у demo-accepted на /skills было «Нет» (SQL с JOIN, IDOR, ошибки, N+1).
const catalog = new Map<string, CatalogEntry>([
  be('be.framework', 3), be('be.api-validation', 2), be('be.authn-impl', 2), be('be.config-secrets', 2), be('be.lang-core', 3),
  be('be.authz', 2), be('be.error-handling', 2), be('be.orm', 2, ['common.sql-queries']), be('be.data-scale', null),
  common('common.http', 3), common('common.debugging', 3), common('common.sql-queries', 3),
].map((e) => [e.id, e]));
const vacancyNeeds = [
  { catalogId: 'be.framework', weight: 3 }, { catalogId: 'be.api-validation', weight: 2 }, { catalogId: 'be.authn-impl', weight: 2 },
  { catalogId: 'be.config-secrets', weight: 2 }, { catalogId: 'common.http', weight: 3 }, { catalogId: 'common.debugging', weight: 2 },
];
// Подтверждённые утверждения demo-accepted в dev-базе (11.10).
const demoAccepted = buildIndex([
  { catalogId: 'be.api-validation', level: 'artifact' }, { catalogId: 'be.authn-impl', level: 'self_reported' },
  { catalogId: 'be.config-secrets', level: 'self_reported' }, { catalogId: 'be.framework', level: 'artifact' },
  { catalogId: 'be.lang-core', level: 'artifact' }, { catalogId: 'common.debugging', level: 'self_reported' },
  { catalogId: 'common.http', level: 'artifact' },
]);

/** Требование закрыто в совпадении ⇔ на карте пробелов не «Нет» (строки нет только у platform). */
function expectConsistent(needs: { catalogId: string; weight: number }[], index: ReturnType<typeof buildIndex>) {
  const coverage = computeCoverage(needs, catalog, index);
  const gaps = new Map(computeGaps(needs, catalog, index, 'junior').map((g) => [g.catalogId, g]));
  for (const item of coverage.items) {
    const gap = gaps.get(item.catalogId);
    if (item.level === null) expect(gap?.currentLevel, item.catalogId).toBeNull();
    else if (item.level === 'platform') expect(gap, item.catalogId).toBeUndefined();
    else expect(gap?.currentLevel, item.catalogId).toBe(item.level);
  }
  expect(new Set(coverage.missing.map((m) => m.catalogId))).toEqual(new Set([...gaps.values()].filter((g) => g.currentLevel === null).map((g) => g.catalogId)));
}

it('demo-accepted: 6 из 6 по вакансии, но до полной категории Backend · Junior не хватает - и это сказано явно', () => {
  const coverage = computeCoverage(vacancyNeeds, catalog, demoAccepted);
  expect(coverage).toMatchObject({ covered: 6, total: 6, missing: [] });
  const { reason, category } = withCategory('backend', 'junior', coverage, catalog, demoAccepted);
  const missing = category!.missing.map((m) => m.catalogId).sort();
  expect(missing).toEqual(['be.authz', 'be.error-handling', 'be.orm', 'common.sql-queries']);
  // ни одно требование вакансии не попало в «не хватает» категории
  for (const n of vacancyNeeds) expect(missing).not.toContain(n.catalogId);
  expect(category).toMatchObject({ id: 'backend:junior', label: 'Backend · Junior', covered: 7, total: 11 });
  expect(reason).toMatch(/^Требования вакансии: Закрываете 6 из 6\. Что ещё усилит профиль для категории Backend · Junior: .+ и ещё 1 - полный список на «Навыках и грейде»$/);
  // «Нет» на карте пробелов категории = ровно category.missing
  const noRows = computeGaps(categoryNeeds(catalog, 'backend:junior'), catalog, demoAccepted, 'junior').filter((g) => g.currentLevel === null);
  expect(noRows.map((g) => g.catalogId).sort()).toEqual(missing);
});

it('для вакансии и для категории: закрытое в совпадении никогда не «Нет» на карте пробелов, и наоборот', () => {
  expectConsistent(vacancyNeeds, demoAccepted);
  expectConsistent(categoryNeeds(catalog, 'backend:junior'), demoAccepted);
  // перебор уровней, включая смежность (be.orm ← common.sql-queries) и platform
  const ids = [...catalog.keys()];
  const levels: (EvidenceLevel | null)[] = [null, 'self_reported', 'artifact', 'third_party', 'platform'];
  let seed = 7;
  for (let run = 0; run < 200; run++) {
    const claims = ids.flatMap((catalogId) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      const level = levels[seed % levels.length];
      return level ? [{ catalogId, level }] : [];
    });
    const index = buildIndex(claims);
    expectConsistent(vacancyNeeds, index);
    expectConsistent(categoryNeeds(catalog, 'backend:junior'), index);
  }
});

it('категории нет в каталоге (senior) - пояснение только по вакансии, без выдуманных пробелов', () => {
  const coverage = computeCoverage(vacancyNeeds, catalog, demoAccepted);
  expect(withCategory('backend', 'senior', coverage, catalog, demoAccepted)).toEqual({ reason: 'Требования вакансии: Закрываете 6 из 6', category: null });
});
