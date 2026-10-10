import { checkAnswer } from '@/server/test/answers';
import { AI_BANK2_GENERATORS } from '@/server/test/generators/ai-bank2';
import { AI_GENERATORS } from '@/server/test/generators/ai';

const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 3);
const SUBS = ['ai.llm-apps', 'ai.ai-integration', 'ai.ml-engineering', 'ai.mlops', 'ai.data-science'];

describe('AI: расширение банка (ai-bank2)', () => {
  it('id уникальны во всём банке AI', () => {
    const ids = AI_GENERATORS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('по каждой подкатегории добавлено 3 Junior, 5 Middle, 4 Senior', () => {
    for (const sub of SUBS) {
      const gs = AI_BANK2_GENERATORS.filter((g) => g.subcategoryId === sub);
      expect(gs.filter((g) => g.grade === 'junior'), sub).toHaveLength(3);
      expect(gs.filter((g) => g.grade === 'middle'), sub).toHaveLength(5);
      expect(gs.filter((g) => g.grade === 'senior'), sub).toHaveLength(4);
    }
  });

  for (const g of AI_BANK2_GENERATORS) {
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
      expect(g.timeLimitSec).toBeGreaterThan(0);
      const prompts = new Set<string>();
      const keys = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        expect(inst.answerKey, `${g.id} ${seed}`).not.toBe('');
        expect(inst.answerKey, `${g.id} ${seed}`).not.toMatch(/NaN|undefined|Infinity/);
        expect(inst.explanation, `${g.id} ${seed}`).not.toMatch(/NaN|undefined|Infinity/);
        expect(`${inst.prompt}${inst.code ?? ''}`, `${g.id} ${seed}`).not.toMatch(/NaN|undefined|Infinity/);
        for (const k of inst.answerKey.split('|')) expect(checkAnswer(g.format, k, inst.answerKey), `${g.id} ${seed}`).toBe(true);
        prompts.add(`${inst.prompt}\n${inst.code ?? ''}`);
        keys.add(inst.answerKey);
      }
      expect(prompts.size).toBeGreaterThanOrEqual(40);
      expect(keys.size).toBeGreaterThanOrEqual(3);
    });
  }
});
