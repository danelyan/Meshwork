// ПРЕДЛОЖЕНИЕ агента: представление «Fullstack» в поиске работодателя.
import { catalogFromFile } from '@/server/claims/catalog-file';
import { asFullstackEvidence, fullstackLabel, fullstackNeeds, fullstackProfile } from '@/server/employer/fullstack';
import { applyIntegrity, passesFilters, rankCandidates, type CandidateEvidence } from '@/server/employer/ranking';
import { filtersToQuery, parseFilters } from '@/server/employer/schemas';
import { DEMO_POOL_FULLSTACK } from '../../../prisma/seed/pool-backend';

const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));

function cand(id: string, categories: CandidateEvidence['categories']): CandidateEvidence {
  return {
    id,
    specialization: 'backend',
    fspState: 'not_linked',
    category: categories?.[0] ?? null,
    categories,
    claims: [{ catalogId: 'be.rest-design', level: 'artifact', statement: 'REST', quote: 'Node.js' }],
  };
}
const be = (grade: 'junior' | 'middle' | 'senior', subcategoryId = 'backend.web-api') => ({ specialization: 'backend' as const, grade, subcategoryId });
const fe = (grade: 'junior' | 'middle' | 'senior') => ({ specialization: 'frontend' as const, grade, subcategoryId: 'frontend.web-apps' });

describe('fullstack: фильтр и грейд', () => {
  const both = cand('both', [fe('junior'), be('middle')]);
  const onlyBe = cand('be', [be('senior')]);
  const noCat = cand('none', undefined);

  it('две категории - проходит, одна или ни одной - нет', () => {
    const f = { fullstack: true };
    expect(passesFilters(both, f)).toBe(true);
    expect(passesFilters(onlyBe, f)).toBe(false);
    expect(passesFilters(noCat, f)).toBe(false);
  });

  it('грейд fullstack - меньший из двух лучших, лучшая категория направления берётся при нескольких', () => {
    expect(fullstackProfile(both)).toEqual({ backend: 'middle', frontend: 'junior', grade: 'junior' });
    expect(fullstackProfile(cand('x', [be('junior'), be('senior', 'backend.data'), fe('middle')]))).toEqual({ backend: 'senior', frontend: 'middle', grade: 'middle' });
    expect(fullstackLabel(fullstackProfile(both)!)).toBe('Fullstack: backend Middle + frontend Junior');
  });

  it('фильтр грейда сравнивается с меньшим из двух (после asFullstackEvidence)', () => {
    const v = asFullstackEvidence(both);
    expect(passesFilters(v, { fullstack: true, grade: 'junior' })).toBe(true);
    expect(passesFilters(v, { fullstack: true, grade: 'middle' })).toBe(false);
  });

  it('ранжирование: в выдаче только кандидат с двумя категориями; штраф за чужое направление не применяется', () => {
    const needs = fullstackNeeds(catalog, 'junior');
    expect(needs.some((n) => n.catalogId.startsWith('be.'))).toBe(true);
    expect(needs.some((n) => n.catalogId.startsWith('fe.'))).toBe(true);
    const target = { specialization: 'backend' as const, subcategoryId: null, grade: 'junior' as const, needs, stack: [] };
    const r = rankCandidates([both, onlyBe].map(asFullstackEvidence), target, catalog, { fullstack: true });
    expect(r.map((x) => x.candidateId)).toEqual(['both']);
    expect(r[0]!.boosts.specPenalty).toBe(0);
  });

  it('drop_category (честность) снимает и список категорий', () => {
    const flagged = { ...both, testIntegrity: { level: 'high' as const, confirmedAgain: false, ownershipExplained: false } } as CandidateEvidence;
    const out = applyIntegrity(flagged, { integrityPenalty: { mode: 'drop_category' } });
    expect(fullstackProfile(out)).toBeNull();
  });
});

describe('fullstack: параметры', () => {
  it('spec=fullstack -> fullstack, без specialization; sub игнорируется; обратно в query', () => {
    const { filters } = parseFilters({ spec: 'fullstack', sub: 'backend.web-api', grade: 'middle' });
    expect(filters).toEqual({ fullstack: true, grade: 'middle' });
    expect(filtersToQuery(filters)).toBe('spec=fullstack&grade=middle');
  });
  it('обычные spec не затронуты, мусор отбрасывается', () => {
    expect(parseFilters({ spec: 'frontend' }).filters).toEqual({ specialization: 'frontend' });
    expect(parseFilters({ spec: 'fullstackk' }).filters).toEqual({});
  });
});

describe('fullstack: демо-профиль', () => {
  it('есть категории в backend и frontend, утверждений не больше 9, все из каталога', () => {
    for (const p of DEMO_POOL_FULLSTACK) {
      const cats = [p.category, ...(p.extraCategories ?? [])].filter(Boolean) as { specialization: 'backend' | 'frontend'; grade: 'junior' | 'middle' | 'senior' }[];
      expect(fullstackProfile({ category: cats[0] ?? null, categories: cats })).not.toBeNull();
      expect(p.claims.length).toBeLessThanOrEqual(9);
      for (const [id] of p.claims) expect(catalog.has(id), id).toBe(true);
    }
  });
});
