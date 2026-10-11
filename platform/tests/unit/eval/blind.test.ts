import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildBlindSet, poolOf } from '../../../eval/matching/blind-set';
import { consensusOf, weightedKappa } from '../../../eval/matching/metrics';
import { parseMatchingResults } from '@/server/validation/matching-results';

describe('eval/matching: слепая разметка', () => {
  it('взвешенная κ: полное совпадение 1, ручной пример, на уровне случая ≈ 0', () => {
    expect(weightedKappa([0, 1, 2, 2], [0, 1, 2, 2])).toBe(1);
    // a = [0,0,2,2], b = [0,2,2,0]: наблюдаемое несогласие 2/4 при весе 1; ожидаемое 0,5 → κ = 0
    expect(weightedKappa([0, 0, 2, 2], [0, 2, 2, 0])).toBeCloseTo(0);
    expect(weightedKappa([0, 1, 2], [2, 1, 0])).toBeLessThan(0);
    expect(() => weightedKappa([0], [0, 1])).toThrow();
  });
  it('консенсус: среднее с округлением половины вверх', () => {
    expect([consensusOf(0, 0), consensusOf(0, 1), consensusOf(1, 2), consensusOf(0, 2), consensusOf(2, 2)]).toEqual([0, 1, 2, 1, 2]);
  });
  it('пул: чередование ours и BM25 без повторов', () => {
    expect(poolOf(['a', 'b', 'c'], ['b', 'x', 'y'], 4)).toEqual(['a', 'b', 'x', 'c']);
  });
  it('выгрузка не содержит скрытой истины и исходных id', () => {
    const { items, key } = buildBlindSet();
    expect(items).toHaveLength(6);
    expect(items.every((v) => v.candidates.length === 30)).toBe(true);
    const text = JSON.stringify(items);
    expect(text).not.toMatch(/syn-|latent|trueGrade|archetype|faked|score/);
    expect(Object.keys(key.V1!.candidates)).toHaveLength(30);
  });
  it('results.json: блок blind разбирается, мусор – null', () => {
    const file = JSON.parse(readFileSync(join(__dirname, '../../../eval/matching/results.json'), 'utf8')) as Record<string, unknown>;
    const iv = { mean: 0.5, lo: 0.3, hi: 0.7 };
    const m = { p5: iv, p5strict: iv, ndcg10: iv };
    const set = { methods: { ours: m, bm25: m }, deltaOursMinusBm25: m };
    const blind = { vacancies: 6, pool: 30, pairs: 180, labelers: { a: 'A', b: 'B' }, kappa: { ab: 0.6, aVsGenerator: 0.4, bVsGenerator: 0.5 }, sets: { a: set, b: set, consensus: set } };
    expect(parseMatchingResults({ ...file, blind }).blind?.kappa.ab).toBe(0.6);
    expect(parseMatchingResults({ ...file, blind: { pool: 'мусор' } }).blind).toBeNull();
    const own = parseMatchingResults(file).blind;
    if (file.blind !== undefined) expect(own).not.toBeNull();
  });
});
