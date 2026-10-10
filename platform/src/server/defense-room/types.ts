// Защита проекта (ступень 3, ADR 0003 docs/decisions/0003-three-stage-assessment.md).
// Сессия — CallSession.kind = defense; здесь — типы плана, транскрипта, вопросов по коду и вердикта.

import type { CallKind } from '../call/types';
import type { DefenseScores } from '../defense/types';

/** Роли реплик транскрипта (контракт ADR 0003). */
export type SpeakerRole = 'ai' | 'candidate' | 'employer';

/** Служебные пометки реплики ИИ — та же форма, что `AiUtteranceMeta` лейна call (server/call/types.ts). */
export interface AiUtteranceMeta {
  /** Тема: тип вопроса QLC и место в коде (`why · src/a.ts:L1-L9`) или «вопрос работодателя». */
  topic: string;
  catalogId: string | null;
  /** 1 — вопрос плана, 2 — уточнение/возврат, 3 — «смени ограничение». */
  level: 1 | 2 | 3;
  routedBy: null;
  fallback?: boolean;
  /** Вопрос из очереди работодателя. */
  employerQuestionId?: string;
}

/** Расширение реплики защиты проекта (лейн call хранит его как есть; интегратору — добавить поле в TranscriptEntry). */
export interface DefenseEntryExt {
  /** Пункт плана, к которому относится реплика ИИ. */
  itemId?: string;
  kind?: 'question' | 'followup' | 'return' | 'closing' | 'greeting';
  /**
   * Компания, чья это реплика (живая реплика работодателя или вопрос из её очереди). Другим
   * компаниям реплика отдаётся скрытой (access.ts redactEntry): кандидат может общаться с несколькими.
   */
  companyId?: string;
  /** Название компании — у реплик работодателя. */
  speaker?: string;
}

/**
 * Реплика транскрипта (CallSession.transcriptJson). Форма — как `TranscriptEntry` лейна call
 * (index, role, text, at, tMs, userId, meta) плюс расширение `defense`.
 */
export interface TranscriptEntry {
  /** 0-based порядковый номер реплики в созвоне; по нему клиенты убирают дубли SSE. */
  index: number;
  role: SpeakerRole;
  text: string;
  /** ISO-время реплики. */
  at: string;
  /** Смещение от начала созвона, мс. */
  tMs: number;
  /** Автор-работодатель (role=employer). */
  userId?: string;
  /** Только у вопросов ИИ (у завершающей реплики нет). */
  meta?: AiUtteranceMeta;
  defense?: DefenseEntryExt;
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
  /** Понимание неровное: часть вопросов прошла порог, часть — почти нулевая (баллы по вопросам, items). */
  'uneven_understanding',
] as const;
export type DefenseFlag = (typeof DEFENSE_FLAGS)[number];

/** Балл по одному вопросу защиты (пункту плана): медиана прогонов по каждому признаку A-02. */
export interface DefenseItemVerdict {
  /** id пункта плана (QLC — `q1`…, вопрос работодателя — `e-<id>`). */
  itemId: string;
  source: 'qlc' | 'employer';
  /** Тип QLC-вопроса; у вопроса работодателя — employer. */
  type: QlcType | 'employer';
  /** Где в коде (`path:L1-L9`); null — без привязки. */
  ref: string | null;
  /** Подпись для карты: «почему так · src/a.ts:L1-L9». */
  label: string;
  /** Вопрос плана (без уточнений). */
  question: string;
  scores: DefenseScores;
  total: number;
  passed: boolean;
  /** Суммы этого вопроса в каждом прогоне оценщика. */
  runs: number[];
  /** Сколько прогонов дали то же решение порога, что медиана. */
  agreement: { same: number; of: number };
  /** Ответов кандидата по вопросу (с уточнениями). */
  answers: number;
  quote: string;
}

export interface DefenseRoomVerdict {
  /**
   * Общий балл по признакам: среднее по вопросам (items), округлённое до 0–2; null — ответов нет.
   * В вердиктах до 10.10 — медиана трёх прогонов по всему транскрипту.
   */
  scores: DefenseScores | null;
  /** Среднее сумм по вопросам, округлённое (0–8). */
  total: number | null;
  /** Среднее сумм по вопросам с одним знаком (0–8); нет в вердиктах до 10.10. */
  totalMean?: number | null;
  /** Баллы по каждому вопросу/файлу — «карта» защиты; нет в вердиктах до 10.10. */
  items?: DefenseItemVerdict[];
  /** Порог защиты утверждения (defense/evaluator THRESHOLD) — тот же. */
  passed: boolean | null;
  /** Общий балл (среднее по вопросам) в каждом прогоне оценщика. */
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
// SSE — имена событий лейна call (server/call/types.ts CALL_EVENT_TYPES)
// ---------------------------------------------------------------------------

export const CALL_EVENT_NAMES = ['snapshot', 'status', 'utterance', 'ai_state', 'participant', 'mute', 'question', 'verdict', 'signal', 'error'] as const;
export type CallEventName = (typeof CALL_EVENT_NAMES)[number];

export interface CallSnapshot {
  sessionId: string;
  kind: CallKind;
  status: 'active' | 'finished' | 'cancelled' | 'pending';
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

/**
 * События звонка защиты. Имена и формы — как у лейна call; отличия: `snapshot.call` — CallSnapshot
 * защиты; `participant`/`question` несут companyId (по нему скрываем чужие компании).
 */
export type CallEvent =
  | { type: 'snapshot'; call: CallSnapshot }
  | { type: 'status'; status: 'active' | 'finished' | 'cancelled' | 'pending' }
  | { type: 'utterance'; entry: TranscriptEntry; done?: boolean }
  | { type: 'ai_state'; state: 'thinking' | 'idle' }
  | { type: 'participant'; userId: string; role: 'employer'; action: 'joined' | 'left'; companyId: string; companyName: string }
  | { type: 'mute'; aiMuted: boolean; userId: string }
  | { type: 'question'; questionId: string; companyId?: string; status: 'queued' | 'asked' | 'answered' }
  | { type: 'verdict'; verdict: DefenseRoomVerdict }
  | { type: 'signal'; from: string; to: string; payload: SignalPayload }
  | { type: 'error'; code: string; message: string };
