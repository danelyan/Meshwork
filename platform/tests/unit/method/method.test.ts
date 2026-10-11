import { information, testInformation } from '@/server/test/irt';
import { MAX_ITEMS, POLICY_VERSION } from '@/server/test/policy';
import { bankInformation, computeSimulatedCandidates, INFO_THETAS, methodPolicy, PERSONAS, simulatedCandidates, topInformation } from '@/server/validation/method';
import { simulatorSubcategories } from '@/server/validation/simulator';

const sub = simulatorSubcategories()[0]!.id;

describe('информационная функция', () => {
  it('информация задания неотрицательна и максимальна при θ = b', () => {
    const item = { a: 1.3, b: 0.4 };
    for (const t of INFO_THETAS) expect(information(t, item)).toBeGreaterThanOrEqual(0);
    const best = INFO_THETAS.reduce((m, t) => (information(t, item) > information(m, item) ? t : m), INFO_THETAS[0]!);
    expect(best).toBeCloseTo(item.b, 5);
    expect(information(item.b, item)).toBeCloseTo((item.a * item.a) / 4, 10);
  });

  it('сумма по банку ≥ 0, кривая грейда — у своих b, потолок попытки — не больше суммы и не меньше любых MAX_ITEMS заданий', () => {
    const info = bankInformation(sub)!;
    expect(info).not.toBeNull();
    expect(info.thetas).toHaveLength(61);
    for (const g of ['junior', 'middle', 'senior'] as const) {
      expect(info.counts[g]).toBeGreaterThan(0);
      for (const v of info.byGrade[g]) expect(v).toBeGreaterThanOrEqual(0);
    }
    const argmax = (ys: number[]) => info.thetas[ys.indexOf(Math.max(...ys))]!;
    // Junior-задания лёгкие, Senior — трудные: пики идут по порядку грейдов.
    expect(argmax(info.byGrade.junior)).toBeLessThan(argmax(info.byGrade.middle));
    expect(argmax(info.byGrade.middle)).toBeLessThan(argmax(info.byGrade.senior));
    info.best.forEach((v, i) => {
      const total = info.byGrade.junior[i]! + info.byGrade.middle[i]! + info.byGrade.senior[i]!;
      expect(v).toBeLessThanOrEqual(total + 1e-9);
      expect(info.bestSe[i]).toBeCloseTo(1 / Math.sqrt(v), 10);
    });
    expect(info.thetas).toContain(info.peakTheta);
  });

  it('topInformation берёт k самых информативных', () => {
    const items = [{ a: 1, b: 0 }, { a: 1, b: 2 }, { a: 1, b: -2 }];
    expect(topInformation(0, items, 1)).toBeCloseTo(information(0, items[0]!), 12);
    expect(topInformation(0, items, 3)).toBeCloseTo(testInformation(0, items), 12);
  });

  it('неизвестная подкатегория — null', () => {
    expect(bankInformation('nope.nope')).toBeNull();
    expect(simulatedCandidates('nope.nope')).toBeNull();
  });
});

describe('смоделированные кандидаты', () => {
  it('агрегат детерминирован по seed и согласован', () => {
    const a = simulatedCandidates(sub, 30)!;
    const b = computeSimulatedCandidates(sub, 30)!;
    expect(a.map((p) => p.id)).toEqual(PERSONAS.map((p) => p.id));
    // Повтор без кэша: тот же результат.
    expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)));
    for (const p of a) {
      expect(p.runs).toBe(30);
      expect(p.minLength).toBeGreaterThan(0);
      expect(p.meanLength).toBeGreaterThanOrEqual(p.minLength);
      expect(p.meanLength).toBeLessThanOrEqual(p.maxLength);
      const sum = p.verdicts.none + p.verdicts.junior + p.verdicts.middle + p.verdicts.senior;
      expect(sum).toBeCloseTo(1, 10);
      expect(p.verdicts[p.claimed]).toBeCloseTo(p.confirmRate, 10);
    }
  });

  it('расчёт без кэша детерминирован (два разных N с общим префиксом seed не смешиваются)', () => {
    const x = simulatedCandidates(sub, 7)!;
    const y = simulatedCandidates(sub, 8)!;
    expect(x[0]!.runs).toBe(7);
    expect(y[0]!.runs).toBe(8);
  });
});

it('политика берётся из policy.ts', () => {
  const p = methodPolicy();
  expect(p.version).toBe(POLICY_VERSION);
  expect(p.maxItems).toBe(MAX_ITEMS);
});

it('две строки по 4 кандидата: уверенный глубже в зоне своего грейда, грейд по θ тот же', async () => {
  const { gradeOfTheta } = await import('@/server/validation/method');
  const { GRADE_CUT } = await import('@/server/test/policy');
  const mid = PERSONAS.filter((p) => p.row === 'mid');
  const conf = PERSONAS.filter((p) => p.row === 'confident');
  expect(mid).toHaveLength(4);
  expect(conf).toHaveLength(4);
  expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(PERSONAS.length);
  mid.forEach((m, i) => {
    const c = conf[i]!;
    expect(c.claimed).toBe(m.claimed);
    expect(gradeOfTheta(c.theta)).toBe(gradeOfTheta(m.theta));
    // Новичок — ниже, остальные — выше середины зоны.
    if (gradeOfTheta(m.theta) === 'none') expect(c.theta).toBeLessThan(m.theta);
    else expect(c.theta).toBeGreaterThan(m.theta);
  });
  // Верхняя треть зоны Junior и Middle.
  const third = (lo: number, hi: number) => lo + ((hi - lo) * 2) / 3;
  expect(conf[1]!.theta).toBeGreaterThanOrEqual(third(GRADE_CUT.junior, GRADE_CUT.middle));
  expect(conf[2]!.theta).toBeGreaterThanOrEqual(third(GRADE_CUT.middle, GRADE_CUT.senior));
});

it('завышение и занижение: доли согласованы с вердиктами и истинным грейдом', async () => {
  const { gradeOfTheta } = await import('@/server/validation/method');
  expect(gradeOfTheta(-1.3)).toBe('none');
  expect(gradeOfTheta(-0.4)).toBe('junior');
  expect(gradeOfTheta(0.35)).toBe('middle');
  expect(gradeOfTheta(1.3)).toBe('senior');
  for (const p of PERSONAS) expect(p.theta).toBeGreaterThanOrEqual(-3);
  for (const p of simulatedCandidates(sub, 30)!) {
    expect(p.truth).toBe(gradeOfTheta(p.theta));
    expect(p.overRate + p.underRate + p.verdicts[p.truth]).toBeCloseTo(1, 10);
  }
});
