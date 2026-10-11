// Типы результата ИИнтервью (CallVerdict.interview). Без серверных импортов – читают клиентские компоненты.
import type { Grade } from '../../lib/grades';
import type { Axis, BlockId } from './model';

/** Статус компетенции – как у темы карты глубины (call/types.ts DepthStatus). */
export type CompetencyStatus = 'confirmed' | 'not_confirmed' | 'inconclusive' | 'not_probed';

export interface CompetencyResult {
  id: string;
  title: string;
  axis: Exclude<Axis, 'grade_fit'>;
  status: CompetencyStatus;
  /** Сколько вопросов задано по компетенции. */
  probed: number;
  /** Самый глубокий уровень вопроса (1–3). */
  maxLevel: 1 | 2 | 3;
  /** Продемонстрированный уровень: грейд по maxLevel, если компетенция подтверждена; иначе null. */
  demonstrated: Grade | null;
  /** Сумма рубрики A-02 (медиана прогонов), 0–8. */
  total: number;
}

export interface AxisResult {
  axis: Axis;
  /** 0–100; null – по оси ничего не проверено. */
  score: number | null;
  probed: number;
  confirmed: number;
}

export type GradeFitLabel = 'match' | 'partial' | 'below' | 'unknown';

export interface InterviewSummary {
  /** Версия модели компетенций и правил расчёта. */
  modelVersion: string;
  claimedGrade: Grade | null;
  axes: AxisResult[];
  gradeFit: { share: number | null; label: GradeFitLabel; text: string };
  /** Итог 0–100 по доступным осям; null – нечего считать. */
  overall: number | null;
  competencies: CompetencyResult[];
  /** Подтверждённые компетенции с наибольшей суммой (названия). */
  strengths: string[];
  /** Проверенные и не подтверждённые (названия). */
  growth: string[];
  /** Блоки, в которых были вопросы. */
  blocks: BlockId[];
}
