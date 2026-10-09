// Правила адаптивного теста (ADR-0002): пороги грейдов, выбор задания, остановка, решение.
// Все числа — ПРЕДЛОЖЕНИЕ: подобраны на симуляции (eval/test), на людях не оценены.
import type { Grade, Specialization } from '../types';

import { estimateTheta, information, probAbove, type Response, type ThetaEstimate } from './irt';
import { createRng } from './rng';

/**
 * Пороги грейдов на шкале θ — границы между популяциями, а не их центры (eval/test/run.ts):
 * Middle −0,1 — середина между Junior N(−0,8; 0,5) и Middle N(0,6; 0,5); Junior −1,5 — между
 * новичком N(−2,1; 0,5) и Junior. Смесь и пороги — [В], уточняются разметкой (docs/test-calibration.md).
 */
export const GRADE_CUT: Record<Grade, number> = { junior: -1.5, middle: -0.1 };

/** Грейд подтверждён, если P(θ > порог) ≥ 0,8. */
export const CONFIRM_PROB = 0.8;

/** Остановка: не раньше MIN, не позже MAX заданий; между ними — если решение уже уверенное. */
export const MIN_ITEMS = 7;
export const MAX_ITEMS = 10;
/** Уверенность для ранней остановки: P(θ > порог) ≥ 0,9 или ≤ 0,1. */
export const EARLY_STOP_PROB = 0.9;
/** Или точность достаточна: SE(θ) ≤ 0,4. */
export const SE_STOP = 0.4;

/** Randomesque: следующее задание — случайное из RANDOMESQUE лучших по информации (анти-утечка). */
export const RANDOMESQUE = 3;
/** Доля заданий одного утверждения в попытке ≤ 40 % (blueprint каталога § 7). */
export const MAX_SHARE_PER_CATALOG = 0.4;

export interface SelectableTemplate {
  id: string;
  a: number;
  b: number;
  catalogIds: string[];
  grade: Grade;
  /** Сколько раз шаблон показан за всё время (экспозиция). */
  exposure?: number;
}

export interface SelectionState {
  /** Уже показанные шаблоны попытки (по порядку). */
  shown: readonly SelectableTemplate[];
  theta: number;
  /** seed попытки + номер задания — детерминированный randomesque. */
  seed: number;
}

/**
 * Выбор следующего шаблона: кандидаты — не показанные в попытке и не нарушающие долю
 * утверждения; ранжирование по информации Фишера при текущей θ̂; из RANDOMESQUE лучших —
 * один по seed. При равной информации предпочитается менее экспонированный.
 */
export function selectNext(pool: readonly SelectableTemplate[], state: SelectionState): SelectableTemplate | null {
  const shownIds = new Set(state.shown.map((t) => t.id));
  const counts = new Map<string, number>();
  for (const t of state.shown) for (const c of t.catalogIds) counts.set(c, (counts.get(c) ?? 0) + 1);
  const limit = Math.max(1, Math.floor(MAX_ITEMS * MAX_SHARE_PER_CATALOG));
  const eligible = pool.filter((t) => !shownIds.has(t.id) && t.catalogIds.every((c) => (counts.get(c) ?? 0) < limit));
  const candidates = eligible.length > 0 ? eligible : pool.filter((t) => !shownIds.has(t.id));
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((t) => ({ t, info: information(state.theta, t) }))
    .sort((x, y) => y.info - x.info || (x.t.exposure ?? 0) - (y.t.exposure ?? 0) || x.t.id.localeCompare(y.t.id));
  const top = ranked.slice(0, RANDOMESQUE);
  return createRng(state.seed).pick(top).t;
}

export interface StopDecision {
  stop: boolean;
  reason: 'max_items' | 'confident' | 'precise' | null;
}

/** Правило остановки по текущей оценке и порогу заявленного грейда. */
export interface StopLimits {
  min: number;
  max: number;
}

export function shouldStop(
  answered: number,
  est: ThetaEstimate,
  grade: Grade,
  poolExhausted = false,
  limits: StopLimits = { min: MIN_ITEMS, max: MAX_ITEMS },
): StopDecision {
  if (answered >= limits.max || (poolExhausted && answered > 0)) return { stop: true, reason: 'max_items' };
  if (answered < limits.min) return { stop: false, reason: null };
  const p = probAbove(est, GRADE_CUT[grade]);
  if (p >= EARLY_STOP_PROB || p <= 1 - EARLY_STOP_PROB) return { stop: true, reason: 'confident' };
  if (est.se <= SE_STOP) return { stop: true, reason: 'precise' };
  return { stop: false, reason: null };
}

export interface GradeDecision {
  theta: number;
  se: number;
  pPass: number;
  pJunior: number;
  confirmed: boolean;
  /** Заявлен Middle, не подтверждён, но Junior подтверждается по той же попытке. */
  juniorOffered: boolean;
}

/** Решение о грейде по ответам (чистое: те же ответы → то же решение). */
export function decide(responses: readonly Response[], grade: Grade, confirmProb: number = CONFIRM_PROB): GradeDecision {
  const est = estimateTheta(responses);
  const pPass = probAbove(est, GRADE_CUT[grade]);
  const pJunior = probAbove(est, GRADE_CUT.junior);
  const confirmed = responses.length > 0 && pPass >= confirmProb;
  return {
    theta: est.theta,
    se: est.se,
    pPass,
    pJunior,
    confirmed,
    juniorOffered: grade === 'middle' && !confirmed && responses.length > 0 && pJunior >= confirmProb,
  };
}

export function specLabel(s: Specialization): string {
  return s === 'backend' ? 'Backend' : 'Frontend';
}

export function gradeLabel(g: Grade): string {
  return g === 'junior' ? 'Junior' : 'Middle';
}

/** Объяснение итога кандидату: без θ-жаргона, с вероятностью и числом решённых. */
export function explainDecision(d: GradeDecision, grade: Grade, answered: number, correct: number): string {
  const pct = Math.round(d.pPass * 100);
  const base = `Решено ${correct} из ${answered}. Уверенность, что уровень не ниже ${gradeLabel(grade)}: ${pct}% (нужно не меньше ${Math.round(CONFIRM_PROB * 100)}%).`;
  if (d.confirmed) return `${base} Грейд ${gradeLabel(grade)} подтверждён.`;
  if (d.juniorOffered) {
    return `${base} Middle не подтверждён, но задания уровня Junior решены уверенно (${Math.round(d.pJunior * 100)}%): можно подтвердить Junior по этой же попытке.`;
  }
  return `${base} Грейд ${gradeLabel(grade)} не подтверждён. Уже подтверждённая категория не снимается.`;
}
