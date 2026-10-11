import { catalogFromFile } from '@/server/claims/catalog-file';
import { checkAnswer } from '@/server/test/answers';
import { bankComplete, familyCounts, poolFor } from '@/server/test/generators';
import { AI_BI_GENERATORS } from '@/server/test/generators/ai-bi';

const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 3);
const SUB = 'ai.bi-analytics';

describe('AI: подкатегория BI-аналитика (ai-bi)', () => {
  it('банк: 8 Junior + 5 Middle + 5 Senior, полный по MIN_FAMILIES_BY_GRADE, пул подкатегории', () => {
    expect(familyCounts(SUB)).toEqual({ junior: 8, middle: 5, senior: 5 });
    expect(AI_BI_GENERATORS.every((g) => g.subcategoryId === SUB && g.specialization === 'ai')).toBe(true);
    expect(bankComplete(AI_BI_GENERATORS)).toBe(true);
    const pool = poolFor('ai', SUB)!;
    expect(pool.legacy).toBe(false);
    expect(pool.generators).toHaveLength(18);
  });

  it('catalogId – записи каталога, и каждое task: генератора есть в proof его записи; id и taskId уникальны', () => {
    const cat = new Map(catalogFromFile().map((e) => [e.id, e]));
    expect(new Set(AI_BI_GENERATORS.map((g) => g.id)).size).toBe(18);
    expect(new Set(AI_BI_GENERATORS.map((g) => g.taskId)).size).toBe(18);
    for (const g of AI_BI_GENERATORS) {
      for (const id of g.catalogIds) expect(cat.has(id), `${g.id} → ${id}`).toBe(true);
      expect(g.catalogIds.some((id) => cat.get(id)!.proof.includes(g.taskId)), g.id).toBe(true);
    }
    for (const id of ['ai.bi-sql-analytics', 'ai.bi-metrics-design', 'ai.bi-dashboards', 'ai.bi-data-modeling', 'ai.bi-experiment-reporting', 'ai.bi-data-quality', 'ai.bi-metric-governance']) expect(cat.has(id), id).toBe(true);
  });

  for (const g of AI_BI_GENERATORS) {
    it(`${g.id}: диапазоны a/b, 50 seed, детерминизм, ключ принимается`, () => {
      expect(g.paramSpace).toBeGreaterThanOrEqual(100);
      expect(g.a).toBeGreaterThanOrEqual(1.0);
      expect(g.a).toBeLessThanOrEqual(1.4);
      if (g.grade === 'junior') {
        expect(g.b).toBeGreaterThanOrEqual(-1.5);
        expect(g.b).toBeLessThanOrEqual(-0.3);
      } else if (g.grade === 'middle') {
        expect(g.b).toBeGreaterThanOrEqual(0.2);
        expect(g.b).toBeLessThanOrEqual(0.9);
      } else {
        expect(g.b).toBeGreaterThanOrEqual(1.0);
        expect(g.b).toBeLessThanOrEqual(1.7);
      }
      const prompts = new Set<string>();
      const keys = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        expect(inst.answerKey, `${g.id} ${seed}`).not.toBe('');
        for (const text of [inst.answerKey, inst.explanation, inst.prompt, inst.code ?? '']) expect(text, `${g.id} ${seed}`).not.toMatch(/NaN|undefined|Infinity/);
        for (const k of inst.answerKey.split('|')) expect(checkAnswer(g.format, k, inst.answerKey), `${g.id} ${seed}`).toBe(true);
        prompts.add(`${inst.prompt}\n${inst.code ?? ''}`);
        keys.add(inst.answerKey);
      }
      expect(prompts.size).toBeGreaterThanOrEqual(40);
      expect(keys.size).toBeGreaterThanOrEqual(3);
    });

    it(`${g.id}: не угадывается (500 seed: самый частый ответ ≤ 20 %, разных ответов ≥ 8)`, () => {
      const counts = new Map<string, number>();
      for (let seed = 1; seed <= 500; seed++) {
        const k = g.generate(seed * 104729 + 11).answerKey;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      expect(counts.size, `${g.id} разных ответов`).toBeGreaterThanOrEqual(8);
      expect(Math.max(...counts.values()) / 500, `${g.id} доля частого ответа`).toBeLessThanOrEqual(0.2);
    });
  }
});
