// Типы теста на грейд (E-03, ADR-0002).
import type { Grade, Specialization } from '../types';

/** Формат ответа: кодом проверяется нормализованная строка (без MCQ, R-T-02). */
export type AnswerFormat = 'number' | 'text' | 'line' | 'list';

export interface TaskInstance {
  /** Условие (текст, допускаются переводы строк). */
  prompt: string;
  /** Код/таблица/схема моноширинным блоком; строки нумеруются с 1 при format = line. */
  code?: string;
  /** Подпись к полю ответа («число», «номер строки», «вывод через запятую»). */
  answerHint: string;
  /** Ключ ответа — только на сервере. Для list — канонический вид. */
  answerKey: string;
  /** Чем объяснить правильный ответ после попытки. */
  explanation: string;
  /** Параметры экземпляра (для журнала и валидации). */
  params: Record<string, unknown>;
}

export interface TaskGenerator {
  /** ID шаблона, он же ID в TaskTemplate: "be.sql-rowcount". */
  id: string;
  /** ID задания каталога (claims-catalog «Доказывается»: task:<id>). */
  taskId: string;
  title: string;
  specialization: Specialization;
  /**
   * Подкатегория семейства ("ai.llm-apps", "backend.web-api") из src/lib/directions.ts (ADR 0003, дополнение
   * 10.10 15:50: тест — на подкатегорию). Пул попытки — только семейства подкатегории кандидата; тест по
   * подкатегории доступен при ≥ MIN_FAMILIES_PER_SUBCATEGORY (8) семействах, Junior и Middle.
   * Необязательно ТОЛЬКО на переходный период, пока лейны генераторов размечают свои семейства: если у
   * направления не размечено ни одно семейство, тест идёт по старому пулу направления (generators/index.ts,
   * poolFor → legacy). Семейство без subcategoryId в размеченном направлении в пул не попадает.
   */
  subcategoryId?: string;
  grade: Grade;
  /** Утверждения каталога, которые подтверждает решённое задание. */
  catalogIds: string[];
  format: AnswerFormat;
  /** ПРЕДЛОЖЕНИЕ: экспертные стартовые a, b (docs/test-calibration.md). */
  a: number;
  b: number;
  /** Мощность пространства экземпляров (порядок величины), для анти-утечки. */
  paramSpace: number;
  /** Мягкий лимит времени на задание, сек. */
  timeLimitSec: number;
  generate(seed: number): TaskInstance;
}

export type AttemptStatus = 'active' | 'passed' | 'not_confirmed' | 'abandoned';

export interface ItemView {
  index: number;
  templateId: string;
  title: string;
  prompt: string;
  code?: string;
  answerHint: string;
  format: AnswerFormat;
  timeLimitSec: number;
  askedAt: string;
}

export interface AnsweredItemView extends ItemView {
  answer: string;
  correct: boolean;
  answerKey: string;
  explanation: string;
  catalogIds: string[];
}

export interface AttemptResult {
  status: Exclude<AttemptStatus, 'active'>;
  theta: number;
  se: number;
  /** P(θ > порог заявленного грейда). */
  pPass: number;
  /** P(θ > порог Junior) — для предложения «подтвердить Junior». */
  pJunior: number;
  /** Заявленный грейд подтверждён. */
  confirmed: boolean;
  /** Middle не подтверждён, но Junior по той же попытке — доступен (R-C-08). */
  juniorOffered: boolean;
  juniorConfirmedAt: string | null;
  answered: number;
  correct: number;
  explanation: string;
  /** Утверждения, поднятые до «платформа» (или которые поднялись бы). */
  confirmedCatalogIds: string[];
  items: AnsweredItemView[];
  finishedAt: string;
}

export interface AttemptView {
  id: string;
  specialization: Specialization;
  grade: Grade;
  status: AttemptStatus;
  mode: 'full' | 'demo';
  /** Сколько заданий отвечено. */
  answered: number;
  /**
   * Фаза: main — основная; junior_probe — заявленный грейд (Middle или Junior) не подтверждён, P(Junior)
   * неуверенная, и дозадаются до JUNIOR_PROBE_MAX Junior-заданий, чтобы уверенно решить про Junior
   * (ADR-0002, «Дозадавание Junior-заданий», 10.10).
   */
  phase: 'main' | 'junior_probe';
  /** Минимум и максимум заданий (прогресс без подсказки о сложности); в junior_probe max — с учётом дозадавания. */
  minItems: number;
  maxItems: number;
  startedAt: string;
  expiresAt: string;
  /** Текущее задание (пока попытка активна). */
  current: ItemView | null;
  result: AttemptResult | null;
}

export interface AttemptSummary {
  id: string;
  specialization: Specialization;
  grade: Grade;
  status: AttemptStatus;
  theta: number | null;
  pPass: number | null;
  answered: number;
  correct: number;
  juniorConfirmedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface StartResult {
  attemptId: string;
  resumed: boolean;
}

export interface EligibilityView {
  allowed: boolean;
  reason?: string;
  nextAllowedAt?: string;
  /** no_test — для направления нет генераторов заданий (тест пока недоступен). */
  code?: 'active_attempt' | 'grade_change_too_soon' | 'retake_too_soon' | 'no_test';
}
