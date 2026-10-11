// Математика калибровки без внешних библиотек: Brier, log-loss, ECE, калибровочная кривая, изотоническая регрессия (PAV).

export interface Pair { score: number; y: number; vacancy: string }
export interface Bin { lo: number; hi: number; n: number; meanScore: number | null; share: number | null }
export interface Knot { x: number; p: number }

const EPS = 1e-6;
/** Границы вероятности в таблице: 0 % и 100 % на выборке в сотни пар – самоуверенность, показывать их нельзя. */
export const P_MIN = 0.02;
export const P_MAX = 0.98;
export const clip01 = (x: number) => Math.max(0, Math.min(1, x));

export function brier(ps: number[], ys: number[]): number {
  return ps.reduce((s, p, i) => s + (p - ys[i]!) ** 2, 0) / ps.length;
}

export function logLoss(ps: number[], ys: number[]): number {
  return -ps.reduce((s, p, i) => {
    const q = Math.min(1 - EPS, Math.max(EPS, p));
    return s + (ys[i]! ? Math.log(q) : Math.log(1 - q));
  }, 0) / ps.length;
}

/** Кривая по `bins` равным интервалам [0;1]: последний включает 1. Прогноз – p (уже в [0;1]). */
export function calibrationCurve(ps: number[], ys: number[], bins = 10): Bin[] {
  const out: { lo: number; hi: number; n: number; sp: number; sy: number }[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sp: 0, sy: 0 }));
  ps.forEach((p, i) => {
    const b = out[Math.min(bins - 1, Math.floor(clip01(p) * bins))]!;
    b.n++; b.sp += p; b.sy += ys[i]!;
  });
  return out.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanScore: b.n ? b.sp / b.n : null, share: b.n ? b.sy / b.n : null }));
}

/** Expected calibration error: взвешенная по n средняя |средний прогноз − доля положительных| по бинам. */
export function ece(curve: Bin[]): number {
  const total = curve.reduce((s, b) => s + b.n, 0);
  return curve.reduce((s, b) => s + (b.n ? (b.n / total) * Math.abs(b.meanScore! - b.share!) : 0), 0);
}

/** Изотоническая регрессия (PAV) по баллу: блоки (средний балл, средняя доля), неубывающие по доле. */
export function isotonicFit(pairs: Pair[], maxKnots = 14): Knot[] {
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  const blocks: { sx: number; sy: number; n: number }[] = [];
  for (const q of sorted) {
    blocks.push({ sx: q.score, sy: q.y, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!, a = blocks[blocks.length - 2]!;
      if (a.sy / a.n <= b.sy / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sx: a.sx + b.sx, sy: a.sy + b.sy, n: a.n + b.n });
    }
  }
  let knots: Knot[] = blocks.map((b) => ({ x: b.sx / b.n, p: b.sy / b.n }));
  // слияние соседних блоков с одинаковой долей (кусочно-постоянные участки) и прореживание до maxKnots
  knots = knots.filter((k, i) => i === 0 || i === knots.length - 1 || k.p !== knots[i - 1]!.p || k.p !== knots[i + 1]!.p);
  while (knots.length > maxKnots) {
    // выкидываем узел, чей вынос меньше всего меняет кривую (минимальное отклонение от линейной интерполяции соседей)
    let best = 1, bestD = Infinity;
    for (let i = 1; i < knots.length - 1; i++) {
      const a = knots[i - 1]!, k = knots[i]!, b = knots[i + 1]!;
      const d = Math.abs(k.p - (a.p + ((b.p - a.p) * (k.x - a.x)) / (b.x - a.x || 1)));
      if (d < bestD) { bestD = d; best = i; }
    }
    knots.splice(best, 1);
  }
  return knots.map((k) => ({ x: Math.round(k.x * 1e4) / 1e4, p: Math.round(Math.min(P_MAX, Math.max(P_MIN, k.p)) * 1e4) / 1e4 }));
}

/** Кусочно-линейная интерполяция по узлам; вне узлов – крайнее значение. */
export function applyKnots(knots: readonly Knot[], score: number): number {
  if (!knots.length) return clip01(score);
  if (score <= knots[0]!.x) return knots[0]!.p;
  const last = knots[knots.length - 1]!;
  if (score >= last.x) return last.p;
  for (let i = 1; i < knots.length; i++) {
    const b = knots[i]!;
    if (score <= b.x) {
      const a = knots[i - 1]!;
      return b.x === a.x ? b.p : a.p + ((b.p - a.p) * (score - a.x)) / (b.x - a.x);
    }
  }
  return last.p;
}

export interface Metrics { n: number; positives: number; brier: number; logLoss: number; ece: number }
export function metricsOf(ps: number[], ys: number[]): Metrics {
  return { n: ys.length, positives: ys.filter(Boolean).length, brier: brier(ps, ys), logLoss: logLoss(ps, ys), ece: ece(calibrationCurve(ps, ys)) };
}
