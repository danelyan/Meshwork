// Созвон кандидата с ИИ (lane call, ADR 0003). Ступень 1 — квалифицирующий созвон (kind=qualifying);
// ступень 3 — защита проекта (kind=defense, lane defense-room) на тех же моделях, событиях и транскрипте.
import type { Score } from '../defense/types';

export const CALL_KINDS = ['qualifying', 'defense'] as const;
export type CallKind = (typeof CALL_KINDS)[number];

// pending — только kind=defense: приглашение на защиту проекта, кандидат ещё не начал (lane project).
export const CALL_STATUSES = ['active', 'finished', 'cancelled', 'pending'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** Кто говорит в созвоне. employer — живой работодатель в комнате защиты (defense-room). */
export const SPEAKER_ROLES = ['ai', 'candidate', 'employer'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

/** Уровень вопроса: 1 — базовый, 2 — рабочий, 3 — глубокий (граница темы). */
export type QuestionLevel = 1 | 2 | 3;

/** Сигнал маршрутизации интервьюера по последнему ответу. Не оценка: оценщик его не видит. */
export const ANSWER_SIGNALS = ['strong', 'weak', 'none'] as const;
export type AnswerSignal = (typeof ANSWER_SIGNALS)[number];

/** Служебные пометки реплики ИИ (план интервьюера). В вердикт и оценщику не передаются. */
export interface AiUtteranceMeta {
  topic: string;
  catalogId: string | null;
  level: QuestionLevel;
  /** Сигнал по предыдущему ответу кандидата, по которому выбран уровень этого вопроса. */
  routedBy: AnswerSignal | null;
  /** true — вопрос из шаблона: модель не ответила валидно. */
  fallback?: boolean;
  /** Вопрос из очереди работодателя (defense-room). */
  employerQuestionId?: string;
}

/** Одна реплика транскрипта (CallSession.transcriptJson — массив таких). */
export interface TranscriptEntry {
  /** 0-based порядковый номер реплики в созвоне. */
  index: number;
  role: SpeakerRole;
  text: string;
  /** Время реплики, ISO. */
  at: string;
  /** Смещение от начала созвона, мс (таймкод). */
  tMs: number;
  /** Сегмент аудио кандидата (имя файла в audioPath), если ответ был голосом. */
  audioRef?: string;
  /** Автор-работодатель (role=employer). */
  userId?: string;
  /** Только у role=ai. */
  meta?: AiUtteranceMeta;
}

/** Баллы рубрики A-02 по одной теме (после проверки цитат кодом). */
export interface TopicScores {
  depth: Score;
  why: Score;
  boundary: Score;
  completion: Score;
}

/** Строка «карты глубины»: тема → заявлено → копнули → подтвердилось/нет. */
export interface DepthMapItem {
  topic: string;
  /** Утверждение каталога, если тема привязана к нему. */
  catalogId: string | null;
  /** Тема заявлена кандидатом (есть утверждение профиля по этому catalogId). */
  claimed: boolean;
  /** Формулировка утверждения кандидата (если claimed). */
  claimStatement: string | null;
  /** Сколько вопросов задано по теме. */
  probed: number;
  /** Самый глубокий уровень вопроса по теме (1–3). */
  maxLevel: QuestionLevel;
  /** Порог рубрики пройден (тот же, что у защиты утверждения: defense/evaluator THRESHOLD). */
  confirmed: boolean;
  /** Медиана трёх прогонов оценщика по каждому критерию. */
  scores: TopicScores;
  total: number;
  /** Дословная цитата кандидата, на которую опирается оценка (пусто — опоры нет). */
  quote: string;
  /** Баллы каждого прогона — для валидации повторяемости. */
  runs: TopicScores[];
}

export interface CallVerdict {
  kind: CallKind;
  depthMap: DepthMapItem[];
  /** Сколько прогонов оценщика запускалось и сколько дали валидный ответ. */
  runs: number;
  validRuns: number;
  /** catalogId утверждений, поднятых до platform этим созвоном. */
  upgradedCatalogIds: string[];
  /** Короткий итог для кандидата и работодателя (строит код). */
  summary: string;
  evaluatedAt: string;
  thresholdVersion: string;
  disclaimer: string;
}

/**
 * События SSE `GET /api/call/{id}/events`. Кадр — `event: <type>\ndata: <json>\n\n`.
 * defense-room переиспользует тот же enum: participant / mute / question / signal — его события.
 */
export const CALL_EVENT_TYPES = [
  /** Первый кадр: состояние созвона, как GET /api/call/{id} для этой роли. */
  'snapshot',
  /** Сменился статус созвона (active → finished/cancelled). */
  'status',
  /** Новая реплика транскрипта (ai / candidate / employer). */
  'utterance',
  /** ИИ думает над репликой / закончил. */
  'ai_state',
  /** Участник вошёл или вышел (работодатель в комнате). */
  'participant',
  /** Работодатель выключил/включил ИИ. */
  'mute',
  /** Вопрос работодателя поставлен в очередь или задан. */
  'question',
  /** Готов вердикт оценщика. */
  'verdict',
  /** Сигналинг WebRTC (sdp / ice) — defense-room. */
  'signal',
  /** Ошибка на сервере (оценщик недоступен и т. п.). */
  'error',
] as const;
export type CallEventType = (typeof CALL_EVENT_TYPES)[number];

export type CallEvent =
  | { type: 'snapshot'; call: CallView }
  | { type: 'status'; status: CallStatus }
  | { type: 'utterance'; entry: TranscriptEntry }
  | { type: 'ai_state'; state: 'thinking' | 'idle' }
  | { type: 'participant'; userId: string; role: 'employer'; action: 'joined' | 'left' }
  | { type: 'mute'; aiMuted: boolean; userId: string }
  | { type: 'question'; questionId: string; status: 'queued' | 'asked' | 'answered' }
  | { type: 'verdict'; verdict: CallVerdict | PublicCallVerdict }
  | { type: 'signal'; from: string; to?: string; payload: unknown }
  | { type: 'error'; code: string; message: string };

/** Кто смотрит созвон и что ему положено. */
export type CallViewerRole = 'candidate' | 'employer';
/** full — транскрипт, цитаты, запись; summary — только оценки по темам (до accepted-приглашения). */
export type CallAccess = 'full' | 'summary';

/** Вердикт для работодателя без доступа к записи: темы и баллы, без цитат кандидата. */
export interface PublicCallVerdict {
  kind: CallKind;
  depthMap: Omit<DepthMapItem, 'quote' | 'claimStatement' | 'runs'>[];
  summary: string;
  evaluatedAt: string;
  thresholdVersion: string;
}

export interface CallView {
  id: string;
  kind: CallKind;
  status: CallStatus;
  projectSubmissionId: string | null;
  startedAt: string;
  finishedAt: string | null;
  access: CallAccess;
  /** null при access=summary. */
  transcript: TranscriptEntry[] | null;
  verdict: CallVerdict | PublicCallVerdict | null;
  /** Есть ли аудио кандидата (для кнопки «Запись»). */
  hasRecording: boolean;
  /** Сколько ответов кандидата и лимиты — для UI («вопрос 3 из 4–6»). */
  progress: { answered: number; minQuestions: number; maxQuestions: number; canFinish: boolean; awaitingAnswer: boolean };
  participants: { userId: string; role: 'employer'; joinedAt: string; leftAt: string | null; aiMuted: boolean }[];
  policyVersion: string;
  disclaimer: string;
}

/** Ответ POST /api/call/{id}/turn: следующая реплика ИИ. */
export interface TurnResult {
  /** Реплика кандидата, как записана. */
  candidate: TranscriptEntry;
  /** Реплика ИИ (null — ИИ замьючен работодателем или созвон закончен). */
  ai: TranscriptEntry | null;
  text: string | null;
  /** TTS делает клиент через /api/tts; поле зарезервировано контрактом. */
  audioUrl?: string;
  /** true — вопросов достаточно, следующий шаг — finish. */
  done: boolean;
}
