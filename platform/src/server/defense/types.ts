// Защита утверждения (лейн defense). Фаза 5 E-01, рубрика A-02, ADR-0001
// «Чего решение не утверждает»: интервью проверяет понимание сейчас, а не
// подлинность истории из резюме.

export interface DefenseQuestion {
  /** 0-based номер вопроса в сессии. */
  index: number;
  question: string;
}

/** Признаки A-02. */
export const CRITERIA = ['depth', 'why', 'boundary', 'completion'] as const;
export type Criterion = (typeof CRITERIA)[number];

export type Score = 0 | 1 | 2;

/** Рубрика A-02, каждая ось 0–2 (баллы после проверки цитат кодом). */
export interface DefenseScores {
  depth: Score;
  why: Score;
  boundary: Score;
  completion: Score;
}

/** Оценка по одному признаку: что сказал оценщик и что засчитал код. */
export interface CriterionResult {
  criterion: Criterion;
  /** Балл после проверки цитаты (нет дословной цитаты → 0). */
  score: Score;
  /** Балл, который поставила модель, до проверки. */
  modelScore: Score;
  /** Цитата из ответа кандидата, на которую опирается балл. */
  quote: string;
  /** Прошла ли цитата проверку кодом (дословное вхождение в ответ). */
  quoteValid: boolean;
  /** Почему цитата не принята (если не принята). */
  quoteRejection?: 'missing' | 'not_verbatim' | 'too_short' | 'instruction_like';
  rationale: string;
}

export interface DefenseVerdict {
  scores: DefenseScores;
  total: number;
  /** Порог (предложение, калибровать на A-03): total ≥ 5 из 8, why ≥ 1, нулей ≤ 1. */
  passed: boolean;
  /** Принятые цитаты из ответов кандидата. */
  quotes: string[];
  /** Объяснение для кандидата: что засчитано и что подтянуть. */
  explanation: string;
  criteria: CriterionResult[];
  /** Источник подтверждения – всегда interview. */
  source: 'interview';
  evaluatedAt: string;
  levelBefore: string;
  /** Уровень после вердикта: platform при passed, иначе без изменений. */
  levelAfter: string;
  /** Версия порога – чтобы пересчитать после калибровки. */
  thresholdVersion: string;
  /** Версия промпта оценщика (EVALUATOR_PROMPT_VERSION); в вердиктах до 11.10 нет. */
  promptVersion?: string;
}

export type DefenseSessionStatus = 'active' | 'completed' | 'abandoned';

/** Состояние сессии для GET /api/defense/[sessionId]. */
export interface DefenseSessionView {
  id: string;
  claimId: string;
  claimStatement: string;
  status: DefenseSessionStatus;
  /** Ждёт ли сессия ответа кандидата (иначе – вердикт или повтор оценки). */
  awaitingAnswer: boolean;
  turns: { index: number; question: string; answer: string | null }[];
  verdict: DefenseVerdict | null;
  limits: DefenseLimits;
  createdAt: string;
  completedAt: string | null;
  /** Честное ограничение для UI (ADR-0001). */
  disclaimer: string;
}

export interface DefenseLimits {
  minQuestions: number;
  maxQuestions: number;
  maxAnswerChars: number;
  /** Попыток на утверждение в окне (предложение). */
  maxAttemptsPerWindow: number;
  windowDays: number;
}

export interface AnswerResult {
  next?: DefenseQuestion;
  verdict?: DefenseVerdict;
}
