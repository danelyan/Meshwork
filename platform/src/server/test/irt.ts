// IRT-ядро теста на грейд (E-03, ADR-0002). Чистые функции без БД и без LLM.
// Модель 2PL: P(верно | θ) = 1 / (1 + exp(−a·(θ − b))). Оценка θ – EAP по сетке
// с априорным N(0, 1); SE – корень дисперсии апостериорного распределения;
// P(θ > порог) – масса апостериорного распределения правее порога.

export interface ItemParams {
  /** Дискриминация (крутизна). ПРЕДЛОЖЕНИЕ: экспертная, 0,8–1,8. */
  a: number;
  /** Сложность на шкале θ. ПРЕДЛОЖЕНИЕ: экспертная, уточняется разметкой (docs/test-calibration.md). */
  b: number;
}

export interface Response extends ItemParams {
  correct: boolean;
}

export interface ThetaEstimate {
  theta: number;
  se: number;
  /** Апостериорное распределение на сетке (для P(θ > порог)). */
  posterior: Float64Array;
}

/** Сетка квадратуры: 81 узел на [−4; 4] с шагом 0,1. */
export const GRID_MIN = -4;
export const GRID_MAX = 4;
export const GRID_STEP = 0.1;
export const GRID: readonly number[] = Array.from({ length: Math.round((GRID_MAX - GRID_MIN) / GRID_STEP) + 1 }, (_, i) =>
  Number((GRID_MIN + i * GRID_STEP).toFixed(4)),
);

const PRIOR: Float64Array = (() => {
  const p = new Float64Array(GRID.length);
  for (let i = 0; i < GRID.length; i++) p[i] = Math.exp(-0.5 * GRID[i]! * GRID[i]!);
  const s = p.reduce((x, y) => x + y, 0);
  for (let i = 0; i < p.length; i++) p[i]! /= s;
  return p;
})();

export function probCorrect(theta: number, item: ItemParams): number {
  return 1 / (1 + Math.exp(-item.a * (theta - item.b)));
}

/** Информация Фишера задания при θ (2PL): a²·P·Q. */
export function information(theta: number, item: ItemParams): number {
  const p = probCorrect(theta, item);
  return item.a * item.a * p * (1 - p);
}

/** EAP-оценка θ по ответам. Без ответов – априорное: θ = 0, SE = 1. */
export function estimateTheta(responses: readonly Response[]): ThetaEstimate {
  const post = new Float64Array(PRIOR);
  for (const r of responses) {
    for (let i = 0; i < GRID.length; i++) {
      const p = probCorrect(GRID[i]!, r);
      post[i]! *= r.correct ? p : 1 - p;
    }
  }
  let sum = 0;
  for (let i = 0; i < post.length; i++) sum += post[i]!;
  if (sum <= 0) return { theta: 0, se: 1, posterior: new Float64Array(PRIOR) };
  let mean = 0;
  for (let i = 0; i < post.length; i++) {
    post[i]! /= sum;
    mean += GRID[i]! * post[i]!;
  }
  let variance = 0;
  for (let i = 0; i < post.length; i++) variance += (GRID[i]! - mean) ** 2 * post[i]!;
  return { theta: mean, se: Math.sqrt(variance), posterior: post };
}

/** P(θ > cut | ответы) по апостериорному распределению. */
export function probAbove(est: ThetaEstimate, cut: number): number {
  let mass = 0;
  for (let i = 0; i < GRID.length; i++) if (GRID[i]! > cut) mass += est.posterior[i]!;
  return mass;
}

/** Суммарная информация теста при θ (кривая информации, для валидации). */
export function testInformation(theta: number, items: readonly ItemParams[]): number {
  return items.reduce((s, it) => s + information(theta, it), 0);
}
