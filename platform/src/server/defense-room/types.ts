// Защита проекта (ступень 3, ADR 0003 docs/decisions/0003-three-stage-assessment.md).
// Сессия — CallSession.kind = defense; здесь — типы плана, транскрипта, вопросов по коду и вердикта.

import type { DefenseScores } from '../defense/types';

/** Роли реплик транскрипта (контракт ADR 0003). */
export type SpeakerRole = 'ai' | 'candidate' | 'employer';

export interface TranscriptEntry {
  /** Порядковый номер реплики в сессии (с 1), по нему клиенты убирают дубли SSE. */
  seq: number;
  role: SpeakerRole;
  text: string;
  /** ISO-время реплики. */
  at: string;
  /** Миллисекунды от начала звонка. */
  t: number;
  /** Кто говорит от работодателя (название компании) — только у role=employer. */
  speaker?: string;
  /**
   * Компания, чья это реплика (живая реплика работодателя или вопрос из её очереди). Другим
   * компаниям такая реплика отдаётся скрытой (`redactFor`): кандидат может общаться с несколькими.
   */
  companyId?: string;
  /** Пункт плана, к которому относится реплика ИИ (вопрос или уточнение). */
  itemId?: string;
  /** Вид реплики ИИ: вопрос плана, уточнение, возврат к вопросу, завершение. */
  kind?: 'question' | 'followup' | 'return' | 'closing' | 'greeting';
}

/** Типы вопросов по коду (QLC, Lehtinen et al.): что делает / почему так / что сломается / измени / смени ограничение. */
export const QLC_TYPES = ['what', 'why', 'what_breaks', 'change', 'constraint'] as const;
export type QlcType = (typeof QLC_TYPES)[number];

export interface QlcQuestion {
  id: string;
  type: QlcType;
  question: string;
  /** Где в коде: `path:L10-L42` или `commit:abc1234`; у «смени ограничение» — null. */
  ref: string | null;
  /** Что должен затронуть хороший ответ — только для интервьюера, оценщик этого не видит. */
  expectedPoints: string[];
}

/** Пункт плана сессии: вопрос по коду или вопрос работодателя из очереди. */
export type PlanItem =
  | ({ source: 'qlc' } & QlcQuestion & { answered: boolean; followUps: number })
  | {
      source: 'employer';
      id: string;
      employerQuestionId: string;
      companyId: string;
      companyName: string;
      question: string;
      answered: boolean;
      followUps: number;
    };

/** Режим старта: полная защита проекта или только ответы на вопросы работодателя (асинхронная дозащита). */
export type DefenseMode = 'project' | 'questions';

// ---------------------------------------------------------------------------
// Репозиторий кандидата
// ---------------------------------------------------------------------------

export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface RepoCommit {
  sha: string;
  message: string;
  date: string;
  /** Изменённые файлы с усечённым diff (только у нескольких последних коммитов). */
  files?: { path: string; patch: string }[];
}

export interface RepoSnapshot {
  repoUrl: string;
  /** Полный SHA, по которому читали дерево. */
  commitSha: string;
  /** Все пути дерева (усечено до лимита). */
  tree: string[];
  /** Прочитанные файлы кода (после фильтра и лимитов). */
  files: RepoFile[];
  commits: RepoCommit[];
  /** Что отрезали лимиты — для честного отчёта. */
  truncated: { treeEntries: number; files: number };
}

/** Фрагмент кода-кандидат для вопроса (функция, метод, класс) — выделяет код, не модель. */
export interface CodeFragment {
  id: string;
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  code: string;
  /** Грубая сложность: ветвления, циклы, обработка ошибок. */
  complexity: number;
}

// ---------------------------------------------------------------------------
// Вердикт
// ---------------------------------------------------------------------------

export const DEFENSE_FLAGS = [
  /** Проект сильный (скрытые тесты), защита ниже порога — флаг работодателю, не понижение. */
  'strong_project_weak_defense',
  /** Ответов слишком мало для устойчивой оценки. */
  'short_defense',
  /** Прогоны оценщика разошлись сильно (разброс суммы ≥ 3) — смотреть транскрипт. */
  'evaluator_disagreement',
  /** Остались вопросы работодателя без ответа. */
  'employer_questions_unanswered',
  /** Результата проверки проекта нет — сравнить проект и защиту нельзя. */
  'no_project_result',
] as const;
export type DefenseFlag = (typeof DEFENSE_FLAGS)[number];

export interface DefenseRoomVerdict {
  /** Медиана трёх прогонов по каждому признаку A-02; null — ответов нет, оценивать нечего. */
  scores: DefenseScores | null;
  total: number | null;
  /** Порог защиты утверждения (defense/evaluator THRESHOLD) — тот же. */
  passed: boolean | null;
  /** Суммы каждого прогона оценщика. */
  runs: number[];
  flags: DefenseFlag[];
  /** Текст для работодателя и кандидата — строит код. Слова «фейк» и вердикта о подлинности нет. */
  summary: string;
  /** Принятые цитаты (из прогона, ближайшего к медиане). */
  quotes: string[];
  /** Доля пройденных скрытых тестов проекта 0…1; null — нет результата. */
  projectScore: number | null;
  answered: number;
  employerQuestions: { asked: number; answered: number };
  thresholdVersion: string;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE (контракт ADR 0003: те же имена, что у лейна call)
// ---------------------------------------------------------------------------

export const CALL_EVENT_NAMES = ['turn', 'participant_joined', 'participant_left', 'ai_muted', 'employer_question', 'status', 'signal'] as const;
export type CallEventName = (typeof CALL_EVENT_NAMES)[number];

export interface CallSnapshot {
  sessionId: string;
  kind: 'qualifying' | 'defense';
  status: 'active' | 'finished' | 'cancelled';
  mode: DefenseMode;
  transcript: TranscriptEntry[];
  participants: { userId: string; companyId: string; companyName: string; aiMuted: boolean }[];
  aiMuted: boolean;
  progress: { asked: number; total: number };
  verdict: DefenseRoomVerdict | null;
}

/** Сигнальное сообщение WebRTC: описание сессии или ICE-кандидат. */
export interface SignalPayload {
  description?: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string };
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null;
}

export type CallEvent =
  | { type: 'turn'; entry: TranscriptEntry; done?: boolean }
  | { type: 'participant_joined'; userId: string; companyId: string; companyName: string }
  | { type: 'participant_left'; userId: string; companyId: string }
  | { type: 'ai_muted'; muted: boolean; by: string }
  | { type: 'employer_question'; questionId: string; companyId?: string; status: 'queued' | 'asked' | 'answered' }
  | { type: 'status'; snapshot: CallSnapshot }
  | { type: 'signal'; from: string; to: string; payload: SignalPayload };
