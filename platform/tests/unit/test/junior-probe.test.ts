// Дозадавание Junior-заданий (R-C-08, ADR-0002 «Дозадавание Junior-заданий»): фаза junior_probe.
import { generatorsFor } from '@/server/test/generators';
import { estimateTheta, probAbove, type Response } from '@/server/test/irt';
import {
  CONFIRM_PROB,
  decide,
  EARLY_STOP_PROB,
  GRADE_CUT,
  JUNIOR_PROBE_MAX,
  MAX_ITEMS,
  MAX_ITEMS_TOTAL,
  needsJuniorProbe,
  nextStep,
  phasePool,
  selectNext,
  type AttemptPhase,
  type SelectableTemplate,
  type Step,
} from '@/server/test/policy';
import { deriveSeed } from '@/server/test/rng';
import type { Grade } from '@/server/types';

const tpl = (id: string, grade: Grade, a: number, b: number): SelectableTemplate => ({ id, grade, a, b, catalogIds: [id] });

/** Банк с «слабыми» Junior-заданиями (a = 0,4): P(Junior) после них остаётся неуверенной. */
const weakPool = [
  ...Array.from({ length: 10 }, (_, i) => tpl(`m${i}`, 'middle', 1.3, 0.5)),
  ...Array.from({ length: 10 }, (_, i) => tpl(`j${i}`, 'junior', 0.4, -0.7)),
];

/** Прогнать попытку циклом сервиса (selectNext по фазе + nextStep). */
function play(pool: readonly SelectableTemplate[], grade: Grade, seed: number, answer: (t: SelectableTemplate, i: number) => boolean) {
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  const phases: AttemptPhase[] = [];
  let phase: AttemptPhase = 'main';
  let step: Step | null = null;
  for (let i = 0; i < 50; i++) {
    const next = selectNext(phasePool(pool, phase), { shown, theta: estimateTheta(responses).theta, seed: deriveSeed(seed, 1000 + i) });
    if (!next) break;
    shown.push(next);
    phases.push(phase);
    responses.push({ a: next.a, b: next.b, correct: answer(next, i) });
    step = nextStep({ pool, shown, responses, grade });
    if (step.stop) break;
    phase = step.phase;
  }
  return { shown, responses, phases, step: step! };
}

describe('Дозадавание Junior', () => {
  it('константы: потолок = MAX_ITEMS + JUNIOR_PROBE_MAX', () => {
    expect(JUNIOR_PROBE_MAX).toBe(3);
    expect(MAX_ITEMS_TOTAL).toBe(MAX_ITEMS + JUNIOR_PROBE_MAX);
  });

  it('needsJuniorProbe: только Middle, не подтверждён, P(Junior) в зоне 0,2…0,8 и есть Junior-шаблоны', () => {
    // 10 Middle-заданий, верны 2 → P(Middle) ≈ 0,20 < 0,8, P(Junior) ≈ 0,64.
    const mixed = estimateTheta(weakPool.slice(0, 10).map((t, i) => ({ a: t.a, b: t.b, correct: i % 5 === 0 })));
    const pJ = probAbove(mixed, GRADE_CUT.junior);
    expect(pJ).toBeGreaterThan(1 - CONFIRM_PROB);
    expect(pJ).toBeLessThan(CONFIRM_PROB);
    expect(needsJuniorProbe(mixed, 'middle', 3)).toBe(true);
    expect(needsJuniorProbe(mixed, 'junior', 3)).toBe(false); // заявлен Junior — фаза не нужна
    expect(needsJuniorProbe(mixed, 'middle', 0)).toBe(false); // Junior-шаблоны кончились
    const none = estimateTheta(weakPool.slice(0, 10).map((t) => ({ a: t.a, b: t.b, correct: false })));
    expect(probAbove(none, GRADE_CUT.junior)).toBeLessThanOrEqual(1 - CONFIRM_PROB);
    expect(needsJuniorProbe(none, 'middle', 3)).toBe(false); // уверенно ниже Junior
    const all = estimateTheta(weakPool.slice(0, 10).map((t) => ({ a: t.a, b: t.b, correct: true })));
    expect(needsJuniorProbe(all, 'middle', 3)).toBe(false); // Middle подтверждён
  });

  it('фаза не включается: основная ещё идёт; Middle подтверждён; всё неверно', () => {
    const bank = generatorsFor('backend').map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
    const early = play(bank, 'middle', 1, () => false);
    expect(early.phases.every((p) => p === 'main')).toBe(true);
    expect(early.step).toMatchObject({ stop: true, phase: 'main' });
    expect(early.shown.length).toBeLessThanOrEqual(MAX_ITEMS);

    const strong = play(weakPool, 'middle', 2, () => true);
    expect(strong.step).toMatchObject({ stop: true, phase: 'main' });
    expect(decide(strong.responses, 'middle').confirmed).toBe(true);

    const r = nextStep({ pool: weakPool, shown: weakPool.slice(0, 3), responses: weakPool.slice(0, 3).map((t) => ({ a: t.a, b: t.b, correct: true })), grade: 'middle' });
    expect(r).toMatchObject({ stop: false, phase: 'main', mainLength: null, maxItems: MAX_ITEMS });
  });

  it('потолок: P(Junior) неуверенная и после дозадавания → стоп на mainLength + JUNIOR_PROBE_MAX, задания только Junior', () => {
    // Основная — 10 Middle-заданий (верно 2), дозадавание — слабые Junior-задания через одно.
    const shown: SelectableTemplate[] = [];
    const responses: Response[] = [];
    let step: Step | null = null;
    const order = [...weakPool.slice(0, 10), ...weakPool.slice(10)];
    for (let i = 0; i < order.length; i++) {
      const t = order[i]!;
      shown.push(t);
      responses.push({ a: t.a, b: t.b, correct: i < 10 ? i % 5 === 0 : i % 2 === 0 });
      step = nextStep({ pool: weakPool, shown, responses, grade: 'middle' });
      if (i === 9) expect(step).toMatchObject({ stop: false, phase: 'junior_probe', mainLength: 10, maxItems: 10 + JUNIOR_PROBE_MAX });
      if (step.stop) break;
    }
    expect(step).toMatchObject({ stop: true, reason: 'max_items', phase: 'junior_probe', mainLength: 10 });
    expect(responses).toHaveLength(MAX_ITEMS_TOTAL);
    const pJ = probAbove(estimateTheta(responses), GRADE_CUT.junior);
    expect(pJ).toBeLessThan(EARLY_STOP_PROB);
    expect(pJ).toBeGreaterThan(1 - EARLY_STOP_PROB);
  });

  it('боевой банк, «все Junior верно, Middle неверно»: дозадавание доводит до уверенного решения и предложения Junior', () => {
    for (const spec of ['backend', 'frontend'] as const) {
      const pool = generatorsFor(spec).map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
      let probed = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const run = play(pool, 'middle', seed, (t) => t.grade === 'junior');
        const probeIdx = run.phases.flatMap((p, i) => (p === 'junior_probe' ? [i] : []));
        expect(run.shown.length).toBeLessThanOrEqual(MAX_ITEMS_TOTAL);
        expect(probeIdx.length).toBeLessThanOrEqual(JUNIOR_PROBE_MAX);
        // Дозаданные — только Junior и без повторов шаблонов.
        for (const i of probeIdx) expect(run.shown[i]!.grade).toBe('junior');
        expect(new Set(run.shown.map((t) => t.id)).size).toBe(run.shown.length);
        if (probeIdx.length > 0) probed++;
        if (run.step.reason === 'junior_resolved') expect(probAbove(estimateTheta(run.responses), GRADE_CUT.junior)).toBeGreaterThanOrEqual(EARLY_STOP_PROB);
        const d = decide(run.responses, 'middle');
        expect(d.confirmed).toBe(false);
        expect(d.juniorOffered).toBe(true);
      }
      expect(probed).toBeGreaterThan(0);
    }
  });

  it('детерминизм: те же ответы → та же фаза и та же остановка', () => {
    const pool = generatorsFor('backend').map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
    const a = play(pool, 'middle', 7, (t) => t.grade === 'junior');
    const b = play(pool, 'middle', 7, (t) => t.grade === 'junior');
    expect(b.shown.map((t) => t.id)).toEqual(a.shown.map((t) => t.id));
    expect(b.step).toEqual(a.step);
  });
});
