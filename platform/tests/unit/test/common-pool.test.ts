// Общие компетенции в пуле подкатегории (ADR 0003, дополнение 11.10; политика adr-0002-v7): карта, пул, доля общих.
import { SUBCATEGORIES } from '@/lib/directions';
import { GRADES, type Grade } from '@/lib/grades';
import { confirmSelectionPool } from '@/server/test/confirm';
import { bankComplete, commonGeneratorsFor, generatorsFor, generatorsForSubcategory, GENERATORS, poolFor } from '@/server/test/generators';
import { COMMON_GENERATORS } from '@/server/test/generators/common';
import { COMMON_BY_SPEC, commonCompetenciesFor } from '@/server/test/generators/common-map';
import { estimateTheta, probCorrect, type Response } from '@/server/test/irt';
import {
  commonAllowed,
  MAX_COMMON_SHARE,
  nextStep,
  phasePool,
  POLICY_VERSION,
  reachableSize,
  RULES_BY_VERSION,
  selectNext,
  START_THETA,
  type AttemptPhase,
  type SelectableTemplate,
} from '@/server/test/policy';
import { createRng, deriveSeed } from '@/server/test/rng';

const tpl = (id: string, grade: Grade, b: number, common = false, a = 1.2): SelectableTemplate => ({ id, a, b, grade, catalogIds: [`cat.${id}`], common });
const B: Record<Grade, number> = { junior: -1, middle: 0.2, senior: 1.3 };

/** Синтетический пул подкатегории: 6 J + 4 M + 4 S своих и по 3 общих на грейд с завышенной дискриминацией (их выбор выгоднее). */
const SYNTH: SelectableTemplate[] = [
  ...GRADES.flatMap((g) => Array.from({ length: { junior: 6, middle: 4, senior: 4 }[g] }, (_, i) => tpl(`own.${g}.${i}`, g, B[g] + i * 0.1))),
  ...GRADES.flatMap((g) => Array.from({ length: 3 }, (_, i) => tpl(`common.${g}.${i}`, g, B[g] + i * 0.05, true, 2))),
];

/** Цикл сервиса (pushNextItem + stepOf): фаза из nextStep, выбор из phasePool, θ̂ по ответам. */
function play(pool: readonly SelectableTemplate[], grade: Grade, seed: number) {
  const rng = createRng(seed);
  const trueTheta = rng.int(-200, 200) / 100;
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  const phases: AttemptPhase[] = [];
  let phase: AttemptPhase = 'main';
  for (let i = 0; i < 40; i++) {
    const theta = responses.length ? estimateTheta(responses).theta : START_THETA[grade];
    const next = selectNext(phasePool(pool, phase, grade), { shown, theta, seed: deriveSeed(seed, 1000 + i) });
    if (!next) break;
    shown.push(next);
    phases.push(phase);
    responses.push({ a: next.a, b: next.b, correct: rng.int(0, 999) / 1000 < probCorrect(trueTheta, next) });
    const step = nextStep({ pool, shown, responses, grade });
    if (step.stop) break;
    phase = step.phase;
  }
  return { shown, phases };
}

describe('лимит доли общих (MAX_COMMON_SHARE)', () => {
  it('префиксное правило: первое общее – не раньше 4-го задания, при 10 – не больше 3', () => {
    expect(MAX_COMMON_SHARE).toBe(0.3);
    const own = (n: number) => Array.from({ length: n }, (_, i) => tpl(`o${i}`, 'junior', 0));
    expect(commonAllowed(own(2))).toBe(false);
    expect(commonAllowed(own(3))).toBe(true);
    expect(commonAllowed([...own(6), tpl('c1', 'junior', 0, true), tpl('c2', 'junior', 0, true)])).toBe(false); // 3-е общее на 9-м месте: floor(2,7) = 2
    expect(commonAllowed([...own(7), tpl('c1', 'junior', 0, true), tpl('c2', 'junior', 0, true)])).toBe(true); // на 10-м: floor(3) = 3
  });

  it('reachableSize: своих 4 + общих 3 → 5 (Senior-пул), без общих – размер пула', () => {
    const senior = SYNTH.filter((t) => t.grade === 'senior');
    expect(reachableSize(senior)).toBe(5);
    expect(reachableSize(senior.filter((t) => !t.common))).toBe(4);
    expect(reachableSize(SYNTH)).toBe(14 + 6);
  });

  it('selectNext не берёт общее сверх лимита даже при пустом остатке своих', () => {
    const pool = [tpl('o1', 'junior', 0), tpl('c1', 'junior', 0, true), tpl('c2', 'junior', 0, true)];
    expect(selectNext(pool, { shown: [], theta: 0, seed: 1 })?.id).toBe('o1');
    expect(selectNext(pool, { shown: [pool[0]!], theta: 0, seed: 1 })).toBeNull();
  });

  for (const grade of GRADES) {
    it(`синтетический пул, заявка ${grade}: 1000 попыток – доля общих ≤ 30 % в каждой, в дозадавании общих нет`, () => {
      let withCommon = 0;
      for (let s = 1; s <= 1000; s++) {
        const { shown, phases } = play(SYNTH, grade, s * 7919 + 3);
        const common = shown.filter((t) => t.common).length;
        expect(common, `seed ${s}`).toBeLessThanOrEqual(Math.floor(MAX_COMMON_SHARE * shown.length));
        shown.forEach((t, i) => {
          if (phases[i] !== 'main') expect(t.common, `seed ${s}: общее в дозадавании`).toBe(false);
        });
        if (common > 0) withCommon++;
      }
      // Общие действительно попадают в попытки (иначе лимит проверялся бы впустую).
      expect(withCommon).toBeGreaterThan(500);
    }, 60_000);
  }

  it('подтверждающий тест: тот же лимит (пул свежих шаблонов, 8 заданий)', () => {
    for (let s = 1; s <= 1000; s++) {
      const source = new Set(SYNTH.filter((t) => !t.common).slice(0, 6).map((t) => t.id));
      const shown: SelectableTemplate[] = [];
      for (let i = 0; i < 8; i++) {
        const next = selectNext(confirmSelectionPool(SYNTH, source, new Set(shown.map((t) => t.id))), { shown, theta: 0.3, seed: deriveSeed(s, i) });
        if (!next) break;
        shown.push(next);
      }
      expect(shown.filter((t) => t.common).length).toBeLessThanOrEqual(Math.floor(MAX_COMMON_SHARE * shown.length));
    }
  });
});

describe('карта и пул подкатегории', () => {
  it('у каждой активной подкатегории есть общие компетенции из списка направления', () => {
    for (const sub of SUBCATEGORIES) expect(commonCompetenciesFor(sub.id), sub.id).toEqual(COMMON_BY_SPEC[sub.specialization]);
    expect(commonCompetenciesFor('nope')).toEqual([]);
  });

  it('общие семейства: без subcategoryId, не входят в generatorsFor и generatorsForSubcategory, id уникальны', () => {
    for (const g of COMMON_GENERATORS) {
      expect(g.shared, g.id).toBeDefined();
      expect(g.subcategoryId, g.id).toBeUndefined();
    }
    const common = new Set(COMMON_GENERATORS.map((g) => g.id));
    for (const sub of SUBCATEGORIES) {
      for (const g of generatorsFor(sub.specialization)) expect(common.has(g.id), g.id).toBe(false);
      for (const g of generatorsForSubcategory(sub.id)) expect(common.has(g.id), g.id).toBe(false);
    }
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
  });

  it('poolFor: без opts.common – только свои (v6 и eval), с common – свои + общие по карте; полнота – по своим', () => {
    for (const sub of SUBCATEGORIES) {
      const own = poolFor(sub.specialization, sub.id);
      if (!own) continue;
      expect(own.commonCount).toBe(0);
      expect(own.generators.every((g) => !g.shared)).toBe(true);
      expect(bankComplete(own.generators)).toBe(true);
      const withCommon = poolFor(sub.specialization, sub.id, { common: true })!;
      const common = commonGeneratorsFor(sub.id);
      expect(withCommon.generators.map((g) => g.id)).toEqual([...own.generators, ...common].map((g) => g.id));
      expect(withCommon.commonCount).toBe(common.length);
      for (const g of common) expect(COMMON_BY_SPEC[sub.specialization]).toContain(g.shared!.competency);
    }
  });

  it('реальные пулы v7 по каждой подкатегории: 1000 попыток (грейды по кругу) – доля общих ≤ 30 %', () => {
    for (const sub of SUBCATEGORIES) {
      const p = poolFor(sub.specialization, sub.id, { common: true });
      if (!p) continue;
      const pool = p.generators.map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade, common: Boolean(g.shared) }));
      for (let s = 1; s <= 1000; s++) {
        const grade = GRADES[s % 3]!;
        const { shown } = play(pool, grade, s * 104729);
        expect(shown.filter((t) => t.common).length, `${sub.id} ${grade} ${s}`).toBeLessThanOrEqual(Math.floor(MAX_COMMON_SHARE * shown.length));
      }
    }
  }, 120_000);

  it('версия политики v7, правила остановки – как v6', () => {
    expect(POLICY_VERSION).toBe('adr-0002-v7');
    expect(RULES_BY_VERSION['adr-0002-v7']).toEqual(RULES_BY_VERSION['adr-0002-v6']);
  });
});
