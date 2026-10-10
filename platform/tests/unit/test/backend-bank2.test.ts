import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { BACKEND_GENERATORS } from '@/server/test/generators/backend';
import { DATAMODEL_BANK2 } from '@/server/test/generators/backend-bank2-datamodel';
import { HIGHLOAD_BANK2 } from '@/server/test/generators/backend-bank2-highload';
import { INTEGRATIONS_BANK2 } from '@/server/test/generators/backend-bank2-integrations';
import { WEBAPI_BANK2 } from '@/server/test/generators/backend-bank2-webapi';

const BANK2 = { 'backend.web-api': WEBAPI_BANK2, 'backend.integrations': INTEGRATIONS_BANK2, 'backend.highload': HIGHLOAD_BANK2, 'backend.data-model': DATAMODEL_BANK2 };
const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 101);

describe('backend банк-2: +12 семейств на подкатегорию', () => {
  for (const [sub, list] of Object.entries(BANK2)) {
    it(`${sub}: 3 Junior + 5 Middle + 4 Senior, подкатегория и каталог заданы`, () => {
      expect(list.length).toBe(12);
      expect(list.filter((g) => g.grade === 'junior').length).toBe(3);
      expect(list.filter((g) => g.grade === 'middle').length).toBe(5);
      expect(list.filter((g) => g.grade === 'senior').length).toBe(4);
      for (const g of list) {
        expect(g.subcategoryId, g.id).toBe(sub);
        expect(g.specialization).toBe('backend');
        expect(g.catalogIds.length, g.id).toBeGreaterThan(0);
        expect(BACKEND_GENERATORS, g.id).toContain(g);
      }
    });
  }

  it('id и taskId уникальны на весь backend, параметры a, b, paramSpace, время в диапазонах грейда', () => {
    expect(new Set(BACKEND_GENERATORS.map((g) => g.id)).size).toBe(BACKEND_GENERATORS.length);
    expect(new Set(BACKEND_GENERATORS.map((g) => g.taskId)).size).toBe(BACKEND_GENERATORS.length);
    for (const g of Object.values(BANK2).flat()) {
      if (g.grade === 'junior') {
        expect(g.b, g.id).toBeGreaterThanOrEqual(-1.5);
        expect(g.b, g.id).toBeLessThanOrEqual(-0.4);
      } else if (g.grade === 'middle') {
        expect(g.b, g.id).toBeGreaterThanOrEqual(0.3);
        expect(g.b, g.id).toBeLessThanOrEqual(0.8);
      } else {
        expect(g.b, g.id).toBeGreaterThanOrEqual(1.0);
        expect(g.b, g.id).toBeLessThanOrEqual(1.7);
      }
      expect(g.a, g.id).toBeGreaterThanOrEqual(1.0);
      expect(g.a, g.id).toBeLessThanOrEqual(1.4);
      expect(g.paramSpace, g.id).toBeGreaterThanOrEqual(100);
      expect(g.timeLimitSec, g.id).toBeGreaterThanOrEqual(120);
    }
  });

  for (const g of Object.values(BANK2).flat()) {
    it(`${g.id}: 50 seed - детерминизм, ключ проходит проверку, есть разнообразие`, () => {
      const variants = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        expect(inst.answerKey.length).toBeGreaterThan(0);
        expect(inst.prompt.length).toBeGreaterThan(40);
        expect(inst.explanation.length).toBeGreaterThan(10);
        expect(inst.answerHint.length).toBeGreaterThan(0);
        for (const k of inst.answerKey.split('|')) expect(checkAnswer(g.format, k, inst.answerKey), `${g.id} seed ${seed}`).toBe(true);
        expect(normalizeAnswer(g.format, inst.answerKey), `${g.id} seed ${seed}`).not.toBeNull();
        if (g.format === 'number' || g.format === 'line') expect(inst.answerKey, `${g.id} seed ${seed}`).toMatch(/^-?\d+(\.\d+)?$/);
        if (g.format === 'line') {
          const n = Number(inst.answerKey);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(inst.code!.split('\n').length);
        }
        expect(inst.prompt + (inst.code ?? '')).not.toMatch(/NaN|undefined|\[object/);
        expect(inst.explanation).not.toMatch(/NaN|undefined|\[object/);
        variants.add(`${inst.prompt}\n${inst.code ?? ''}`);
      }
      expect(variants.size, g.id).toBeGreaterThanOrEqual(25);
    });
  }

  it('угадываемость: по 500 seed не меньше 8 разных ответов, доля самого частого не больше 20 %', () => {
    const many = Array.from({ length: 500 }, (_, i) => (i + 1) * 7919 + 13);
    for (const g of Object.values(BANK2).flat()) {
      const count = new Map<string, number>();
      for (const s of many) {
        const k = g.generate(s).answerKey;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      expect(count.size, g.id).toBeGreaterThanOrEqual(8);
      expect(Math.max(...count.values()) / many.length, g.id).toBeLessThanOrEqual(0.2);
    }
  });
});
