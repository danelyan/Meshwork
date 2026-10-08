import type { EvidenceLevel } from '../claims/types';
import type { Grade } from '../types';

/**
 * ПРЕДЛОЖЕНИЕ (не требование ТЗ): веса уровней доказанности в покрытии и
 * приоритете пробелов. Данных под числа нет — калибруем на eval.
 */
export const LEVEL_WEIGHT: Record<EvidenceLevel, number> = {
  self_reported: 0.25,
  artifact: 0.5,
  third_party: 0.75,
  platform: 1,
};

/** ПРЕДЛОЖЕНИЕ: смежное утверждение даёт половину веса своего уровня (claims-catalog § 6). */
export const ADJACENT_FACTOR = 0.5;

/** ПРЕДЛОЖЕНИЕ (R-C-09): интервал смены грейда, дней. Интервал ТЗ оставляет на выбор команды. */
export const GRADE_CHANGE_INTERVAL_DAYS = 30;

/** ПРЕДЛОЖЕНИЕ (claims-catalog § 7): пороги покрытия сигнатуры Middle. */
export const MIDDLE_THRESHOLD = 0.6;
export const MIDDLE_IF_SURE_THRESHOLD = 0.3;

export const GRADE_INDEX: Record<Grade, number> = { junior: 0, middle: 1 };

/** ПРЕДЛОЖЕНИЕ: «посильность» — цель не выше доказанного грейда + 1; иначе множитель 0,5. */
export const REACH_PENALTY = 0.5;

export function levelWeight(level: EvidenceLevel | null | undefined): number {
  return level ? LEVEL_WEIGHT[level] : 0;
}

export function bestLevel(levels: Iterable<EvidenceLevel>): EvidenceLevel | null {
  let best: EvidenceLevel | null = null;
  for (const l of levels) if (best === null || LEVEL_WEIGHT[l] > LEVEL_WEIGHT[best]) best = l;
  return best;
}
