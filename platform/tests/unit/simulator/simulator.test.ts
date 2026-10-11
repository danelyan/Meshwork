import { SUBCATEGORIES } from '@/lib/directions';
import { poolFor } from '@/server/test/generators';
import { estimateTheta, probCorrect, type Response } from '@/server/test/irt';
import { decide, GRADE_CUT, MAX_ITEMS_TOTAL, nextStep, phasePool, POLICY_VERSION, rulesFor, selectNext, START_THETA, type AttemptPhase, type SelectableTemplate } from '@/server/test/policy';
import { createRng, deriveSeed } from '@/server/test/rng';
import { parseSimInput, SimInputError, simulate, simulatorSubcategories } from '@/server/validation/simulator';

const SUB = 'backend.web-api';
const base = { subcategoryId: SUB, claimed: 'middle', theta: 0.3, mode: 'ideal', seed: 7 } as const;

describe('simulate', () => {
  it('детерминирован по seed и зависит от seed', () => {
    expect(simulate(base)).toEqual(simulate(base));
    expect(simulate({ ...base, seed: 8 }).steps.map((s) => s.templateId + s.correct)).not.toEqual(simulate(base).steps.map((s) => s.templateId + s.correct));
  });

  it('высокая θ даёт грейд выше, чем низкая (медиана по seed)', () => {
    const rank = (theta: number) => {
      const xs = Array.from({ length: 15 }, (_, i) => {
        const r = simulate({ ...base, claimed: 'senior', theta, seed: i + 1 });
        return r.theta;
      }).sort((a, b) => a - b);
      return xs[7]!;
    };
    expect(rank(2.5)).toBeGreaterThan(rank(-2.5) + 1);
    const hi = simulate({ ...base, claimed: 'middle', theta: 2.5, seed: 3 });
    const lo = simulate({ ...base, claimed: 'middle', theta: -2.5, seed: 3 });
    expect(hi.confirmed).toBe(true);
    expect(lo.confirmed).toBe(false);
  });

  it('длина — в пределах политики, шаги согласованы', () => {
    const rules = rulesFor(POLICY_VERSION);
    for (const claimed of ['junior', 'middle', 'senior'] as const) {
      for (const theta of [-2, 0, 2]) {
        const r = simulate({ ...base, claimed, theta });
        expect(r.length).toBe(r.steps.length);
        expect(r.length).toBeGreaterThan(0);
        expect(r.length).toBeLessThanOrEqual(MAX_ITEMS_TOTAL);
        if (claimed !== 'senior') expect(r.length).toBeGreaterThanOrEqual(Math.min(rules.min, r.length));
        expect(new Set(r.steps.map((s) => s.templateId)).size).toBe(r.length);
        expect(r.steps.map((s) => s.n)).toEqual(r.steps.map((_, i) => i + 1));
      }
    }
  });

  it('совпадает с ручным прогоном движка (ideal, 2 сценария)', () => {
    for (const [claimed, theta, seed] of [['middle', 0.5, 11], ['junior', -1.2, 5]] as const) {
      const sub = SUBCATEGORIES.find((s) => s.id === SUB)!;
      const pool = poolFor(sub.specialization, sub.id, { common: true })!.generators.map(
        (g): SelectableTemplate => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade, common: Boolean(g.shared) }),
      );
      const rng = createRng(deriveSeed(seed, 9000));
      const shown: SelectableTemplate[] = [];
      const responses: Response[] = [];
      let phase: AttemptPhase = 'main';
      for (let i = 0; i < pool.length; i++) {
        const th = responses.length ? estimateTheta(responses).theta : START_THETA[claimed];
        const next = selectNext(phasePool(pool, phase, claimed), { shown, theta: th, seed: deriveSeed(seed, 1000 + i) })!;
        shown.push(next);
        responses.push({ a: next.a, b: next.b, correct: rng.next() < probCorrect(theta, next) });
        const st = nextStep({ pool, shown, responses, grade: claimed }, rulesFor(POLICY_VERSION));
        if (st.stop) break;
        phase = st.phase;
      }
      const d = decide(responses, claimed);
      const r = simulate({ subcategoryId: SUB, claimed, theta, mode: 'ideal', seed });
      expect(r.steps.map((s) => s.templateId)).toEqual(shown.map((s) => s.id));
      expect(r.steps.map((s) => s.correct)).toEqual(responses.map((x) => x.correct));
      expect(r.theta).toBeCloseTo(d.theta, 12);
      expect(r.confirmed).toBe(d.confirmed);
      expect(r.cuts).toEqual(GRADE_CUT);
    }
  });

  it('режимы noise и leak работают и детерминированы', () => {
    for (const mode of ['noise', 'leak'] as const) {
      const r = simulate({ ...base, mode });
      expect(r).toEqual(simulate({ ...base, mode }));
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it('не отдаёт ключей и ловушек', () => {
    const json = JSON.stringify(simulate(base));
    expect(json).not.toMatch(/answerKey|canary|prompt/i);
  });

  it('отвергает неверный вход', () => {
    expect(() => parseSimInput({ ...base, theta: 9 })).toThrow(SimInputError);
    expect(() => parseSimInput({ ...base, seed: -1 })).toThrow(SimInputError);
    expect(() => parseSimInput({ ...base, mode: 'guess' })).toThrow(SimInputError);
    expect(() => simulate({ ...base, subcategoryId: 'nope.x' })).toThrow(SimInputError);
  });

  it('список подкатегорий — из справочника и реестра генераторов', () => {
    const subs = simulatorSubcategories();
    expect(subs.length).toBeGreaterThan(0);
    for (const s of subs) expect(SUBCATEGORIES.some((d) => d.id === s.id)).toBe(true);
  });
});
