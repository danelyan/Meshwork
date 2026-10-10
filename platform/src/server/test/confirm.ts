// Подтверждающий тест (ADR-0002, дополнение 11.10): короткая попытка после индекса честности high.
// Чистые функции: пул, остановка, решение. Грейд по нему считается по объединению ответов исходной попытки
// (без заданий с флагами времени и ловушки) и подтверждающей. Числа — ПРЕДЛОЖЕНИЕ, на людях не оценены.
import type { Grade } from '../types';

import type { IntegrityLevel } from './integrity';
import { estimateTheta, probAbove, type Response } from './irt';
import { CONFIRM_PROB, EARLY_STOP_PROB, GRADE_CUT, type SelectableTemplate } from './policy';

export const CONFIRM_MIN_ITEMS = 6;
export const CONFIRM_MAX_ITEMS = 8;
/** Лимит времени подтверждающего теста — 0,7 обычного (для флага overtime). */
export const CONFIRM_TIME_FACTOR = 0.7;
/** Ловушек: в обычной попытке 2, в подтверждающей 1. */
export const GRADE_CANARIES = 2;
export const CONFIRM_CANARIES = 1;
/**
 * Согласованность (11.10, решение владельца по симуляции лейна D): |θ̂(чистые исходные) − θ̂(подтверждающие)| ≤
 * CONSISTENCY_Z · sqrt(SE_исх² + SE_подтв²) — SE разности. Без неё читер без помощи проходил 52–58 % (персоны).
 */
export const CONSISTENCY_Z = 2;

export function confirmTimeLimit(timeLimitSec: number): number {
  return Math.max(10, Math.round(timeLimitSec * CONFIRM_TIME_FACTOR));
}

/**
 * Пул выбора следующего задания подтверждающего теста: сначала шаблоны, которых не было в исходной попытке.
 * Когда они кончились (в подкатегории 14 семейств, исходная попытка берёт 7–13), — шаблоны исходной попытки
 * с новыми числами (генератор, другой seed). Уже показанные в этой попытке исключает selectNext.
 */
export function confirmSelectionPool<T extends SelectableTemplate>(pool: readonly T[], sourceTemplateIds: ReadonlySet<string>, shownIds: ReadonlySet<string>): T[] {
  const fresh = pool.filter((t) => !sourceTemplateIds.has(t.id));
  if (fresh.some((t) => !shownIds.has(t.id))) return fresh;
  return pool.filter((t) => sourceTemplateIds.has(t.id));
}

/** Остались ли ещё задания для подтверждающего теста (не показанные в нём). */
export function confirmRemaining(pool: readonly SelectableTemplate[], shownIds: ReadonlySet<string>): number {
  return pool.filter((t) => !shownIds.has(t.id)).length;
}

/**
 * Остановка подтверждающего теста: CONFIRM_MAX_ITEMS или пул исчерпан; с CONFIRM_MIN_ITEMS — как только решение по
 * объединённым ответам уверенное (P ≥ 0,9 или ≤ 0,1).
 */
export function confirmShouldStop(answered: number, combined: readonly Response[], grade: Grade, remaining: number): boolean {
  if (answered >= CONFIRM_MAX_ITEMS || (remaining === 0 && answered > 0)) return true;
  if (answered < CONFIRM_MIN_ITEMS) return false;
  const p = probAbove(estimateTheta(combined), GRADE_CUT[grade]);
  return p >= EARLY_STOP_PROB || p <= 1 - EARLY_STOP_PROB;
}

/** Ответы исходной попытки без заданий с флагами времени или ловушки. */
export function cleanResponses<T extends { index: number }>(items: readonly T[], flaggedItems: readonly number[]): T[] {
  const flagged = new Set(flaggedItems);
  return items.filter((i) => !flagged.has(i.index));
}

export interface ConfirmDecision {
  theta: number;
  se: number;
  /** P(θ > порог грейда) по объединённым ответам. */
  pPass: number;
  pJunior: number;
  /** P ≥ CONFIRM_PROB, ответы согласованы и риск подтверждающей попытки не high. */
  confirmed: boolean;
  /** θ̂ исходных чистых и подтверждающих ответов расходятся не больше CONSISTENCY_Z SE разности. */
  consistent: boolean;
  /** Порог пройден и ответы согласованы, но сама подтверждающая попытка получила high. */
  blockedByRisk: boolean;
}

export function decideConfirm(source: readonly Response[], confirm: readonly Response[], grade: Grade, confirmRisk: IntegrityLevel, confirmProb: number = CONFIRM_PROB): ConfirmDecision {
  const est = estimateTheta([...source, ...confirm]);
  const pPass = probAbove(est, GRADE_CUT[grade]);
  const eSrc = estimateTheta(source);
  const eOwn = estimateTheta(confirm);
  const consistent = Math.abs(eSrc.theta - eOwn.theta) <= CONSISTENCY_Z * Math.sqrt(eSrc.se ** 2 + eOwn.se ** 2);
  const passes = confirm.length > 0 && pPass >= confirmProb && consistent;
  return {
    consistent,
    theta: est.theta,
    se: est.se,
    pPass,
    pJunior: probAbove(est, GRADE_CUT.junior),
    confirmed: passes && confirmRisk !== 'high',
    blockedByRisk: passes && confirmRisk === 'high',
  };
}
