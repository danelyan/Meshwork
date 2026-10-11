import { describe, expect, it } from 'vitest';

import { bm25Rank, tokenize } from '../../../eval/matching/bm25';
import { bootstrapDiff, bootstrapMean, ndcgAtK, precisionAtK, recallAtK, reciprocalRank } from '../../../eval/matching/metrics';
import { generateSynthetic, truthRelevance } from '../../../eval/matching/synthetic';

describe('eval/matching: метрики', () => {
  const rel = { a: 2, b: 1, c: 0, d: 1 };
  it('P@k, Recall@k, MRR на ручном примере', () => {
    expect(precisionAtK(['c', 'a', 'b', 'x'], rel, 2)).toBe(0.5);
    expect(precisionAtK(['a'], rel, 5)).toBe(0.2); // пустые места — промах
    expect(recallAtK(['a', 'c', 'b'], rel, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(['a'], { a: 0 }, 3)).toBeNull();
    expect(reciprocalRank(['c', 'x', 'b'], rel)).toBeCloseTo(1 / 3);
    expect(reciprocalRank(['c'], rel)).toBe(0);
  });
  it('nDCG@k: ручной расчёт (выдача [b, a, c])', () => {
    const dcg = 1 / Math.log2(2) + 3 / Math.log2(3);
    const ideal = 3 / Math.log2(2) + 1 / Math.log2(3) + 1 / Math.log2(4);
    expect(ndcgAtK(['b', 'a', 'c'], rel, 3)).toBeCloseTo(dcg / ideal);
    expect(ndcgAtK(['a', 'b', 'd'], rel, 3)).toBeCloseTo(1);
    expect(ndcgAtK(['a'], { a: 0 }, 3)).toBe(0);
  });
  it('бутстреп детерминирован, интервал накрывает среднее; парная разница', () => {
    const xs = [0.2, 0.4, 0.6, 0.8, 1, 0.5];
    const a = bootstrapMean(xs, 1000, 7);
    expect(bootstrapMean(xs, 1000, 7)).toEqual(a);
    expect(a.lo).toBeLessThanOrEqual(a.mean);
    expect(a.hi).toBeGreaterThanOrEqual(a.mean);
    expect(bootstrapMean([0.5, 0.5, 0.5], 100, 1)).toEqual({ mean: 0.5, lo: 0.5, hi: 0.5 });
    expect(bootstrapDiff([1, 1, 1], [0, 0, 0], 100, 1).mean).toBe(1);
  });
});

describe('eval/matching: BM25', () => {
  it('токенизация: регистр, C#/Node.js, усечение до 6 знаков', () => {
    expect(tokenize('Писал сервис на C# и Node.js.')).toEqual(['писал', 'сервис', 'на', 'c#', 'node.j']);
    expect(tokenize('транзакциями')).toEqual(['транза']);
  });
  it('игрушечный корпус: редкий термин весит больше, длинный документ — меньше', () => {
    const docs = [
      { id: 'a', text: 'kafka kafka postgres' },
      { id: 'b', text: 'postgres postgres postgres' },
      { id: 'c', text: 'react vue css' },
      { id: 'd', text: 'kafka ' + 'шум '.repeat(30) },
    ];
    const r = bm25Rank(docs, 'kafka postgres');
    expect(r[0]!.id).toBe('a');
    expect(r.find((x) => x.id === 'c')!.score).toBe(0);
    expect(r.findIndex((x) => x.id === 'd')).toBeLessThan(r.findIndex((x) => x.id === 'c'));
    expect(r.find((x) => x.id === 'd')!.score).toBeLessThan(r.find((x) => x.id === 'a')!.score);
    // ручной расчёт для документа b, запрос «postgres»: N=4, df=2, dl=3, avgdl=(3+3+3+31)/4=10
    const idf = Math.log(1 + (4 - 2 + 0.5) / (2 + 0.5));
    const tf = 3;
    const exp = (idf * tf * 2.2) / (tf + 1.2 * (1 - 0.75 + (0.75 * 3) / 10));
    expect(bm25Rank(docs, 'postgres').find((x) => x.id === 'b')!.score).toBeCloseTo(exp, 10);
  });
});

describe('eval/matching: синтетический набор', () => {
  const s = generateSynthetic(123);
  it('детерминирован по seed и различается между seed', () => {
    expect(generateSynthetic(123).profiles.map((p) => p.id + JSON.stringify(p.claims))).toEqual(s.profiles.map((p) => p.id + JSON.stringify(p.claims)));
    expect(generateSynthetic(123).relevance).toEqual(s.relevance);
    expect(JSON.stringify(generateSynthetic(124).relevance)).not.toBe(JSON.stringify(s.relevance));
  });
  it('размер, разнообразие и непустая разметка', () => {
    expect(s.vacancies.length).toBeGreaterThanOrEqual(20);
    expect(s.profiles.length).toBeGreaterThanOrEqual(200);
    expect(new Set(s.vacancies.map((v) => v.specialization)).size).toBe(4);
    expect(new Set(s.vacancies.map((v) => v.grade)).size).toBe(3);
    expect(new Set(s.profiles.map((p) => p.archetype)).size).toBe(11);
    for (const v of s.vacancies) expect(Object.values(s.relevance[v.id]!).filter((r) => r > 0).length).toBeGreaterThan(0);
    expect(s.profiles.filter((p) => p.archetype === 'strong_category_only').every((p) => p.claims.length === 0 && p.category)).toBe(true);
    expect(s.profiles.filter((p) => p.archetype === 'strong_self_only').every((p) => p.claims.every(([, l]) => l === 'self_reported'))).toBe(true);
  });
  it('разметка зависит от латентных навыков и грейда, а не от заявленного', () => {
    const v = { grade: 'middle' as const, needs: [['x', 3], ['y', 1]] as [string, number][] };
    expect(truthRelevance({ x: 0.95, y: 0.95 }, 'middle', v).rel).toBe(2);
    expect(truthRelevance({ x: 0.7, y: 0.7 }, 'junior', v).rel).toBe(1); // mastery 0,8, грейд на ступень ниже: 0,8 × 0,7 = 0,56
    expect(truthRelevance({ x: 0.1, y: 0.1 }, 'senior', v).rel).toBe(0);
    // переоценивший себя: заявил много, умеет мало → 0 при любых заявленных утверждениях
    const over = s.profiles.find((p) => p.archetype === 'overclaimer' && p.claims.length > 5)!;
    expect(over).toBeDefined();
    for (const vac of s.vacancies) expect(s.relevance[vac.id]![over.id]).toBe(truthRelevance(over.latent, over.trueGrade, vac).rel);
  });
});

describe('ranking: режим абляции (RankOptions.ablate)', async () => {
  const { scoreCandidate, ABLATION_SIGNALS } = await import('../../../src/server/employer/ranking');
  const { catalogFromFile } = await import('../../../src/server/claims/catalog-file');
  const entries = catalogFromFile().filter((e) => e.specialization === 'backend');
  const [A, B] = [entries[0]!, entries[1]!];
  const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
  const cand = {
    id: 'c1', specialization: 'backend', fspState: 'linked',
    category: { specialization: 'backend', grade: 'middle' },
    claims: [
      { catalogId: A.id, level: 'platform', statement: A.statement, quote: 'Kafka' },
      { catalogId: B.id, level: 'artifact', statement: B.statement, quote: 'Postgres' },
    ],
  } as never;
  const target = { specialization: 'backend', grade: 'middle', needs: [{ catalogId: A.id, weight: 1 }, { catalogId: B.id, weight: 1 }], stack: ['Kafka'] } as never;
  const off = (s: (typeof ABLATION_SIGNALS)[number]) => scoreCandidate(cand, target, catalog as never, { year: 2026, ablate: [s] })!;
  const full = scoreCandidate(cand, target, catalog as never, { year: 2026 })!;

  it('без ablate - прежний балл, пустой список - то же самое', () => {
    expect(scoreCandidate(cand, target, catalog as never, { year: 2026, ablate: [] })!.score).toBe(full.score);
    expect(full.boosts.category).toBeGreaterThan(0);
    expect(full.boosts.fsp).toBeGreaterThan(0);
    expect(full.boosts.stack).toBeGreaterThan(0);
  });
  it('каждый сигнал обнуляет свой вклад и больше ничего не трогает', () => {
    expect(off('category').boosts.category).toBe(0);
    expect(off('category').categoryMatch).toBe(false);
    expect(off('fsp').boosts.fsp).toBe(0);
    expect(off('stack').boosts.stack).toBe(0);
    expect(off('coverage').coverageScore).toBe(0);
    expect(off('coverage').boosts.category).toBeGreaterThan(0); // база категории остаётся
    expect(off('fsp').coverageScore).toBe(full.coverageScore);
    expect(off('fsp').boosts.stack).toBe(full.boosts.stack);
    for (const s of ABLATION_SIGNALS) expect(off(s).score).toBeLessThanOrEqual(full.score + 1e-9);
  });
  it('доказанность: все утверждения считаются «со слов», покрытие падает', () => {
    expect(off('proven').coverageScore).toBeLessThan(full.coverageScore);
    expect(off('proven').covered).toBe(full.covered);
  });
  it('штраф специализации снимается', () => {
    const wrong = { ...(cand as object), specialization: 'frontend', category: null } as never;
    const a = scoreCandidate(wrong, target, catalog as never, { year: 2026 })!;
    const b = scoreCandidate(wrong, target, catalog as never, { year: 2026, ablate: ['spec_penalty'] })!;
    expect(a.boosts.specPenalty).toBeGreaterThan(0);
    expect(b.boosts.specPenalty).toBe(0);
  });
});
