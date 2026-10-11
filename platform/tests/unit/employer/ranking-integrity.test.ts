// Параметр integrityPenalty (вариант 2 индекса честности, eval/matching/integrity.ts): выключен — порядок прежний.
import { applyIntegrity, rankCandidates, scoreCandidate, type CandidateEvidence, type MatchTarget } from '@/server/employer/ranking';

import { fixtureCatalog } from '../../helpers/recommend-fixtures';

const catalog = fixtureCatalog();
const target: MatchTarget = {
  specialization: 'backend',
  grade: 'middle',
  needs: [
    { catalogId: 'be.idempotency', weight: 3 },
    { catalogId: 'be.transactions', weight: 3 },
    { catalogId: 'be.message-queue', weight: 2 },
    { catalogId: 'be.sql-indexes', weight: 2 },
  ],
  stack: [],
};
const middle = { specialization: 'backend' as const, grade: 'middle' as const };

function cand(id: string, claims: string[], extra: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    id,
    specialization: 'backend',
    fspState: 'not_linked',
    category: null,
    claims: claims.map((catalogId) => ({ catalogId, level: 'self_reported' as const, statement: `Утверждение ${catalogId}`, quote: '' })),
    ...extra,
  };
}

// «Списал»: категория Middle, одно требование; честный: два требования, без категории; ещё один — категория без утверждений.
const pool = [
  cand('cheat', ['be.idempotency'], { category: middle, testIntegrity: { level: 'high' } }),
  cand('honest', ['be.idempotency', 'be.transactions']),
  cand('bare', [], { category: middle, testIntegrity: { level: 'high' } }),
  cand('medium', ['be.sql-indexes'], { category: middle, testIntegrity: { level: 'medium' } }),
];
const ids = (opts?: Parameters<typeof rankCandidates>[4]) => rankCandidates(pool, target, catalog, {}, opts).map((r) => `${r.candidateId}:${r.score}`);
const stripped = pool.map((c) => ({ ...c, testIntegrity: undefined }));

describe('integrityPenalty в ранжировании', () => {
  it('выключен (нет опции) — порядок и баллы те же, что без индекса', () => {
    expect(ids()).toEqual(rankCandidates(stripped, target, catalog).map((r) => `${r.candidateId}:${r.score}`));
    expect(ids({})).toEqual(ids());
    expect(ids()[0]).toMatch(/^cheat:/); // категория Middle сейчас поднимает его выше честного
  });

  it('2a drop_category: при high категория не учитывается, кандидат без покрытия выпадает', () => {
    const r = rankCandidates(pool, target, catalog, {}, { integrityPenalty: { mode: 'drop_category' } });
    expect(r.map((x) => x.candidateId)).toEqual(['honest', 'medium', 'cheat']);
    const cheat = r.find((x) => x.candidateId === 'cheat')!;
    expect(cheat.categoryMatch).toBe(false);
    expect(cheat.boosts.category).toBe(0);
    expect(cheat.explanation.category).toContain('не учтена');
    // фильтр по грейду категории: флагнутый не проходит, medium проходит
    const f = rankCandidates(pool, target, catalog, { grade: 'middle' }, { integrityPenalty: { mode: 'drop_category' } });
    expect(f.map((x) => x.candidateId)).toEqual(['medium']);
  });

  it('2b multiplier: балл high × factor, у medium и без индекса без изменений', () => {
    const off = Object.fromEntries(pool.map((c) => [c.id, scoreCandidate(c, target, catalog)!.score]));
    const on = Object.fromEntries(pool.map((c) => [c.id, scoreCandidate(c, target, catalog, { integrityPenalty: { mode: 'multiplier', factor: 0.7 } })!.score]));
    expect(on.cheat).toBeCloseTo(off.cheat! * 0.7, 3);
    expect(on.bare).toBeCloseTo(off.bare! * 0.7, 3);
    expect(on.honest).toBe(off.honest);
    expect(on.medium).toBe(off.medium);
  });

  it('категория, выданная подтверждающим тестом (confirmedAgain), не штрафуется', () => {
    const c = cand('c', ['be.idempotency'], { category: middle, testIntegrity: { level: 'high', confirmedAgain: true } });
    expect(applyIntegrity(c, { integrityPenalty: { mode: 'drop_category' } })).toBe(c);
    expect(scoreCandidate(c, target, catalog, { integrityPenalty: { mode: 'multiplier', factor: 0.5 } })!.score).toBe(scoreCandidate(c, target, catalog)!.score);
  });
});
