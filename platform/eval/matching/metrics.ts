// Метрики ранжирования для eval подбора: Precision@k и nDCG@k с градуированной релевантностью.

/** Доля релевантных (rel ≥ 1) среди первых k выданных; k — номинальный (пустые места считаются промахом). */
export function precisionAtK(ranked: string[], rel: Record<string, number>, k: number): number {
  const hits = ranked.slice(0, k).filter((id) => (rel[id] ?? 0) > 0).length;
  return hits / k;
}

/** Потолок P@k: сколько релевантных вообще есть (если их меньше k, P@k = 1 недостижим). */
export function maxPrecisionAtK(rel: Record<string, number>, k: number): number {
  return Math.min(k, Object.values(rel).filter((r) => r > 0).length) / k;
}

function dcg(gains: number[]): number {
  return gains.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
}

/** nDCG@k: DCG выдачи / DCG идеальной выдачи. Нет релевантных — 0. */
export function ndcgAtK(ranked: string[], rel: Record<string, number>, k: number): number {
  const ideal = dcg(Object.values(rel).sort((a, b) => b - a).slice(0, k));
  if (ideal === 0) return 0;
  return dcg(ranked.slice(0, k).map((id) => rel[id] ?? 0)) / ideal;
}

/** Recall@k: доля релевантных (rel ≥ 1), попавших в первые k. Нет релевантных — null (вакансия не участвует в среднем). */
export function recallAtK(ranked: string[], rel: Record<string, number>, k: number): number | null {
  const total = Object.values(rel).filter((r) => r > 0).length;
  if (total === 0) return null;
  return ranked.slice(0, k).filter((id) => (rel[id] ?? 0) > 0).length / total;
}

/** Обратный ранг первого релевантного (rel ≥ 1); в выдаче релевантных нет — 0. */
export function reciprocalRank(ranked: string[], rel: Record<string, number>): number {
  const i = ranked.findIndex((id) => (rel[id] ?? 0) > 0);
  return i < 0 ? 0 : 1 / (i + 1);
}

/** Детерминированный ГПСЧ (mulberry32): один seed — одна последовательность. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval { mean: number; lo: number; hi: number }

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function percentile(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const i = Math.floor(pos);
  return sorted[i]! + (sorted[Math.min(i + 1, sorted.length - 1)]! - sorted[i]!) * (pos - i);
}

/**
 * Бутстреп по вакансиям: среднее и перцентильный 95 % интервал (2,5 и 97,5 %) по `reps` пересэмплам с возвращением.
 * Вакансии — единица выборки: профили внутри вакансии не независимы.
 */
export function bootstrapMean(values: number[], reps: number, seed: number): Interval {
  const rnd = mulberry32(seed);
  const n = values.length;
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rnd() * n)]!;
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return { mean: avg(values), lo: percentile(means, 0.025), hi: percentile(means, 0.975) };
}

/** Парный бутстреп разницы a − b по одним и тем же вакансиям (одни пересэмплы индексов для обеих). */
export function bootstrapDiff(a: number[], b: number[], reps: number, seed: number): Interval {
  if (a.length !== b.length) throw new Error('bootstrapDiff: разная длина');
  return bootstrapMean(a.map((x, i) => x - b[i]!), reps, seed);
}
