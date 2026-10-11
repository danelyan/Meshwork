// Второй пакет семейств engineering (решение владельца 11.10): 48 семейств, по 12 на подкатегорию.
// 50 seed: детерминизм, ключ проходит проверку ответов, диапазоны параметров, уникальность id.
// 500 seed: угадываемость – доля самого частого ответа ≤ 20 % и не меньше 8 разных ответов.
import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { DATA_BANK2 } from '@/server/test/generators/engineering-bank2-data';
import { DEVOPS_BANK2 } from '@/server/test/generators/engineering-bank2-devops';
import { QA_BANK2 } from '@/server/test/generators/engineering-bank2-qa';
import { SRE_BANK2 } from '@/server/test/generators/engineering-bank2-sre';
import { ENGINEERING_GENERATORS } from '@/server/test/generators/engineering';
import { deriveSeed } from '@/server/test/rng';

const ALL = [...DATA_BANK2, ...DEVOPS_BANK2, ...QA_BANK2, ...SRE_BANK2];
const SEEDS50 = Array.from({ length: 50 }, (_, i) => deriveSeed(20261011, i));
const SEEDS500 = Array.from({ length: 500 }, (_, i) => deriveSeed(20261012, i));

describe('engineering bank2', () => {
  it('48 семейств: по 3 J + 5 M + 4 S на подкатегорию, подключены в агрегатор, id и taskId уникальны', () => {
    expect(ALL).toHaveLength(48);
    for (const sub of ['data-eng', 'devops', 'qa-automation', 'sre']) {
      const own = ALL.filter((g) => g.subcategoryId === `engineering.${sub}`);
      expect(own.filter((g) => g.grade === 'junior')).toHaveLength(3);
      expect(own.filter((g) => g.grade === 'middle')).toHaveLength(5);
      expect(own.filter((g) => g.grade === 'senior')).toHaveLength(4);
    }
    expect(new Set(ALL.map((g) => g.id)).size).toBe(48);
    expect(new Set(ALL.map((g) => g.taskId)).size).toBe(48);
    const reg = new Set(ENGINEERING_GENERATORS.map((g) => g.id));
    for (const g of ALL) expect(reg.has(g.id), g.id).toBe(true);
  });

  for (const g of ALL) {
    describe(g.id, () => {
      it('параметры в диапазонах', () => {
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
        expect(g.catalogIds.length).toBeGreaterThan(0);
      });

      it('50 seed: детерминизм, ключ принимается проверкой', () => {
        for (const seed of SEEDS50) {
          const inst = g.generate(seed);
          expect(g.generate(seed)).toEqual(inst);
          expect(inst.prompt.length).toBeGreaterThan(20);
          expect(inst.explanation.length).toBeGreaterThan(10);
          expect(normalizeAnswer(g.format, inst.answerKey), `${seed}`).not.toBeNull();
          expect(checkAnswer(g.format, inst.answerKey, inst.answerKey)).toBe(true);
        }
      });

      it('500 seed: угадываемость – частота моды ≤ 20 %, разных ответов ≥ 8', () => {
        const freq = new Map<string, number>();
        for (const seed of SEEDS500) {
          const k = g.generate(seed).answerKey;
          freq.set(k, (freq.get(k) ?? 0) + 1);
        }
        const top = Math.max(...freq.values()) / SEEDS500.length;
        expect(freq.size, `${g.id}: разных ответов`).toBeGreaterThanOrEqual(8);
        expect(top, `${g.id}: доля моды`).toBeLessThanOrEqual(0.2);
      });
    });
  }
});
