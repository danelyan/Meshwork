import type { CatalogEntry, EvidenceLevel } from '../claims/types';
import type { Grade, Specialization } from '../types';

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

/**
 * Пороги покрытия сигнатуры Middle (claims-catalog § 7). MIDDLE_THRESHOLD = 0,25 — решение
 * владельца 09.10 по research/13 (было 0,6, затем 0,4), подобрано на gold eval, не на выходе
 * извлекателя. Зоны: ≥ 0,25 — тест Middle; [0,15; 0,25) — Junior, «Middle — если уверены»;
 * < 0,15 — Junior.
 */
export const MIDDLE_THRESHOLD = 0.25;
export const MIDDLE_IF_SURE_THRESHOLD = 0.15;

export const GRADE_INDEX: Record<Grade, number> = { junior: 0, middle: 1 };

/** ПРЕДЛОЖЕНИЕ: «посильность» — цель не выше доказанного грейда + 1; иначе множитель 0,5. */
export const REACH_PENALTY = 0.5;

/**
 * Вес записи каталога для грейда в специализации (каталог § 7). null — в этом грейде
 * не ожидается. У common веса заданы отдельно по специализациям. Без `weights`
 * (старые данные, фикстуры) — общий `weight` для грейдов из `grades`.
 */
export function gradeWeight(entry: CatalogEntry, spec: Specialization, grade: Grade): number | null {
  const w = entry.weights;
  if (w) {
    const byGrade = 'junior' in w ? w : w[spec];
    return byGrade?.[grade] ?? null;
  }
  return entry.grades.includes(grade) ? entry.weight : null;
}

export function levelWeight(level: EvidenceLevel | null | undefined): number {
  return level ? LEVEL_WEIGHT[level] : 0;
}

export function bestLevel(levels: Iterable<EvidenceLevel>): EvidenceLevel | null {
  let best: EvidenceLevel | null = null;
  for (const l of levels) if (best === null || LEVEL_WEIGHT[l] > LEVEL_WEIGHT[best]) best = l;
  return best;
}
