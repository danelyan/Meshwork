// Контракт подбора (лейн recommend). Типы Gap/TaskRec/TargetRec/Coverage в плане
// не были расписаны — это предложение foundation, лейн recommend может расширять.
import type { EvidenceLevel } from '../claims/types';
import type { Grade, Specialization } from '../types';

export type GapTarget = { kind: 'category' | 'vacancy'; id: string };

export interface Gap {
  /** = catalogId; recommendTasks принимает эти id */
  id: string;
  catalogId: string;
  statement: string;
  weight: 1 | 2 | 3;
  /** Текущий лучший уровень по утверждению; null — утверждения нет */
  currentLevel: EvidenceLevel | null;
  /** вес × (1 − уровень) × посильность; больше — важнее */
  priority: number;
  suggestedProof: string[];
}

export interface TestRecommendation {
  specialization: Specialization;
  grade: Grade;
  reason: string;
  allowed: boolean;
  nextAllowedAt?: string;
}

export interface TaskRec {
  taskId: string;
  title: string;
  family: string;
  grade: Grade;
  /** catalogId, которые закрывает задание */
  closes: string[];
  reason: string;
}

export interface CoverageItem {
  catalogId: string;
  statement: string;
  weight: number;
  level: EvidenceLevel | null;
  /** вклад: вес уровня (self 0.25, artifact 0.5, third_party 0.75, platform 1) */
  credit: number;
}

export interface TargetRec {
  vacancyId: string;
  companyId: string;
  companyName: string;
  title: string;
  specialization: Specialization;
  grade: Grade;
  salaryFrom: number;
  salaryTo: number;
  covered: number;
  total: number;
  missing: { catalogId: string; statement: string }[];
  /** «закрываешь k из n, не хватает …» */
  reason: string;
}

export interface Coverage {
  invitationId: string;
  vacancyId: string;
  items: CoverageItem[];
  score: number;
  covered: number;
  total: number;
  explanation: string;
}

/** Причина рекомендации теста, пока нет ни одного подтверждённого утверждения (черновики не считаются). */
export const NO_CONFIRMED_REASON = 'подтверди карточки — тогда предложу тест';
