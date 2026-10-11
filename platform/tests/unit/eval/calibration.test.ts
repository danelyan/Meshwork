import { describe, expect, it } from 'vitest';

import { applyKnots, brier, calibrationCurve, ece, isotonicFit, logLoss } from '../../../eval/matching/calib-math';
import results from '../../../eval/matching/results.json';
import { CALIBRATION_KNOTS, scoreToProbability } from '../../../src/server/employer/calibration';
import { parseMatchingResults } from '../../../src/server/validation/matching-results';

describe('scoreToProbability', () => {
  it('границы: ниже и выше таблицы - крайние значения, внутри (0; 1)', () => {
    expect(scoreToProbability(-1)).toBe(CALIBRATION_KNOTS[0]![1]);
    expect(scoreToProbability(0)).toBe(CALIBRATION_KNOTS[0]![1]);
    expect(scoreToProbability(50)).toBe(CALIBRATION_KNOTS[CALIBRATION_KNOTS.length - 1]![1]);
    expect(scoreToProbability(Number.NaN)).toBe(CALIBRATION_KNOTS[0]![1]);
    for (const s of [0, 0.1, 0.3, 0.6, 1.2]) { const p = scoreToProbability(s); expect(p).toBeGreaterThan(0); expect(p).toBeLessThan(1); }
  });
  it('монотонность: балл растёт - вероятность не убывает', () => {
    let prev = -1;
    for (let s = -0.1; s <= 1.3; s += 0.005) { const p = scoreToProbability(s); expect(p).toBeGreaterThanOrEqual(prev); prev = p; }
  });
  it('линейна между узлами', () => {
    const [[x0, p0], [x1, p1]] = [CALIBRATION_KNOTS[3]!, CALIBRATION_KNOTS[4]!];
    expect(scoreToProbability((x0 + x1) / 2)).toBeCloseTo((p0 + p1) / 2, 6);
  });
  it('таблица в коде совпадает с calibration.relevant.knots из results.json (иначе пересчитать и скопировать)', () => {
    const knots = (results as { calibration: { relevant: { knots: { x: number; p: number }[] } } }).calibration.relevant.knots;
    expect(CALIBRATION_KNOTS.map(([x, p]) => ({ x, p }))).toEqual(knots);
  });
});

describe('eval/matching: математика калибровки', () => {
  it('Brier и log-loss на ручном примере', () => {
    expect(brier([1, 0, 0.5], [1, 0, 1])).toBeCloseTo(0.25 / 3);
    expect(logLoss([0.5, 0.5], [1, 0])).toBeCloseTo(Math.log(2));
  });
  it('кривая и ECE: идеально откалиброванные бины дают 0, смещённые - разницу', () => {
    const ps = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 0.9];
    const ok = calibrationCurve(ps, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(ok.reduce((s, b) => s + b.n, 0)).toBe(12);
    expect(ece(ok)).toBeCloseTo((10 / 12) * 0 + (2 / 12) * 0.1, 6);
    expect(ece(calibrationCurve([0.2, 0.2], [1, 1]))).toBeCloseTo(0.8);
  });
  it('изотоническая регрессия неубывающая и склеивает нарушения порядка', () => {
    const pairs = [0.1, 0.2, 0.3, 0.4, 0.5].map((score, i) => ({ score, y: [0, 1, 0, 1, 1][i]!, vacancy: 'v' }));
    const knots = isotonicFit(pairs);
    for (let i = 1; i < knots.length; i++) { expect(knots[i]!.p).toBeGreaterThanOrEqual(knots[i - 1]!.p); expect(knots[i]!.x).toBeGreaterThan(knots[i - 1]!.x); }
    expect(applyKnots(knots, 0.25)).toBeCloseTo(0.5, 6); // (0,2; 1) и (0,3; 0) склеены в блок со средней 0,5
  });
});

describe('results.json: ключ calibration', () => {
  const cal = parseMatchingResults(results).calibration;
  it('разбирается; калибровка улучшает Brier на отложенной половине, ECE падает', () => {
    expect(cal).not.toBeNull();
    expect(cal!.relevant.holdout.brierAfter).toBeLessThan(cal!.relevant.holdout.brierBefore);
    expect(cal!.relevant.afterInSample.ece).toBeLessThan(cal!.relevant.before.ece);
    expect(cal!.relevant.curveBefore).toHaveLength(10);
    expect(cal!.relevant.curveBefore.reduce((s, b) => s + b.n, 0)).toBe(cal!.relevant.pairs);
  });
  it('нет ключа или мусор - null, страница не падает', () => {
    const base = { summary: results.summary, rows: results.rows };
    expect(parseMatchingResults(base).calibration).toBeNull();
    expect(parseMatchingResults({ ...base, calibration: { x: 1 } }).calibration).toBeNull();
  });
});
