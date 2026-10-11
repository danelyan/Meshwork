import { SPECIALIZATIONS, SUBCATEGORIES } from '@/lib/directions';
import { GENERATORS } from '@/server/test/generators';
import { bankTotals, familiesOf, labFamily, normalizeSeed, VARIANTS } from '@/server/mechanics/lab';
import { buildMechanicsData } from '@/server/mechanics/page-data';

const FAMILY = GENERATORS.find((g) => g.subcategoryId && !g.shared)!;

describe('labFamily', () => {
  it('детерминирован по seed', () => {
    expect(labFamily(FAMILY.id, 7)).toEqual(labFamily(FAMILY.id, 7));
    expect(labFamily(FAMILY.id, 7)!.variants).toHaveLength(VARIANTS);
  });

  it('разные seed дают разные варианты', () => {
    const a = labFamily(FAMILY.id, 1)!.variants.map((v) => v.seed);
    const b = labFamily(FAMILY.id, 2)!.variants.map((v) => v.seed);
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
    // хотя бы в одном из первых семейств варианты внутри набора отличаются условием или кодом
    const some = GENERATORS.slice(0, 12).some((g) => new Set(labFamily(g.id, 3)!.variants.map((v) => v.prompt + (v.code ?? ''))).size > 1);
    expect(some).toBe(true);
  });

  it('в выводе нет строк-ловушек, а в данных реестра их нет изначально', () => {
    for (const g of GENERATORS) {
      const lab = labFamily(g.id, 5)!;
      for (const v of lab.variants) expect(`${v.prompt}\n${v.code ?? ''}\n${v.explanation}`).not.toMatch(/языков\S* модел/i);
    }
  });

  it('неизвестное семейство - null, seed нормализуется', () => {
    expect(labFamily('nope', 1)).toBeNull();
    expect(normalizeSeed('abc')).toBe(1);
    expect(normalizeSeed('-5.7')).toBe(5);
  });
});

describe('bankTotals и страница', () => {
  it('считается из реестра', () => {
    const t = bankTotals();
    expect(t.total).toBe(GENERATORS.length);
    expect(Object.values(t.perGrade).reduce((s, n) => s + n, 0)).toBe(GENERATORS.length);
    expect(t.perSpec).toHaveLength(SPECIALIZATIONS.length);
  });

  it('данные страницы терпимы к мусору в query', () => {
    const d = buildMechanicsData({ spec: 'zzz', sub: 'x', family: 'y', seed: '??' });
    expect(d.spec).toBe(SPECIALIZATIONS[0]);
    expect(d.family).not.toBeNull();
    const sub = SUBCATEGORIES.find((s) => familiesOf(s.id).length > 0)!;
    const d2 = buildMechanicsData({ spec: sub.specialization, sub: sub.id });
    expect(d2.subcategoryId).toBe(sub.id);
  });
});
