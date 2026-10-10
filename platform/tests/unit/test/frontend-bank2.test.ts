// Расширенный банк frontend (решение владельца 11.10): +12 семейств на подкатегорию (3 Junior, 5 Middle, 4 Senior).
import { checkAnswer } from '@/server/test/answers';
import { generatorsFor } from '@/server/test/generators';
import { FRONTEND_BANK2_GENERATORS } from '@/server/test/generators/frontend-bank2';

const SUBS = ['frontend.ui-app', 'frontend.design-system', 'frontend.web-perf', 'frontend.realtime'];
const SEEDS = Array.from({ length: 50 }, (_, i) => i * 104729 + 7);
const bySub = (sub: string) => FRONTEND_BANK2_GENERATORS.filter((g) => g.subcategoryId === sub);

describe('расширенный банк frontend: состав', () => {
  for (const sub of SUBS) {
    it(`${sub}: +3 Junior, +5 Middle, +4 Senior`, () => {
      const gs = bySub(sub);
      expect(gs.filter((g) => g.grade === 'junior')).toHaveLength(3);
      expect(gs.filter((g) => g.grade === 'middle')).toHaveLength(5);
      expect(gs.filter((g) => g.grade === 'senior')).toHaveLength(4);
    });
  }

  it('id уникальны во всём направлении и все семейства подключены к пулу', () => {
    const all = generatorsFor('frontend');
    expect(new Set(all.map((g) => g.id)).size).toBe(all.length);
    for (const g of FRONTEND_BANK2_GENERATORS) expect(all.map((x) => x.id), g.id).toContain(g.id);
  });

  it('параметры в диапазонах грейда', () => {
    for (const g of FRONTEND_BANK2_GENERATORS) {
      expect(g.a, g.id).toBeGreaterThanOrEqual(1.0);
      expect(g.a, g.id).toBeLessThanOrEqual(1.4);
      const [lo, hi] = g.grade === 'junior' ? [-1.5, -0.3] : g.grade === 'middle' ? [0.2, 0.9] : [1.0, 1.7];
      expect(g.b, g.id).toBeGreaterThanOrEqual(lo);
      expect(g.b, g.id).toBeLessThanOrEqual(hi);
      expect(g.paramSpace, g.id).toBeGreaterThanOrEqual(100);
      expect(g.timeLimitSec, g.id).toBeGreaterThan(0);
      expect(g.catalogIds.length, g.id).toBeGreaterThan(0);
      expect(g.id.startsWith('fe.b2-'), g.id).toBe(true);
    }
  });
});

describe('расширенный банк frontend: 50 seed', () => {
  for (const g of FRONTEND_BANK2_GENERATORS) {
    it(g.id, () => {
      const seen = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed), `детерминизм ${seed}`).toEqual(inst);
        expect(inst.prompt.trim().length).toBeGreaterThan(10);
        expect(inst.explanation.length).toBeGreaterThan(10);
        expect(inst.answerKey.length).toBeGreaterThan(0);
        expect(inst.answerKey, 'ключ не должен быть NaN/undefined').not.toMatch(/NaN|undefined(?!$)|Infinity/);
        for (const k of inst.answerKey.split('|')) expect(checkAnswer(g.format, k, inst.answerKey), `${seed}: ${k}`).toBe(true);
        if (g.format === 'number') expect(Number.isFinite(Number(inst.answerKey)), `${seed}: ${inst.answerKey}`).toBe(true);
        seen.add(`${inst.prompt}\n${inst.code ?? ''}`);
      }
      expect(seen.size, `${g.id}: разных экземпляров`).toBeGreaterThanOrEqual(10);
    });
  }
});
