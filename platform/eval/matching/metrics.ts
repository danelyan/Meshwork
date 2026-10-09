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
