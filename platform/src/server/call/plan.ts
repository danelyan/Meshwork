// Маршрут интервьюера по уровню и выбор темы — чистые функции (без БД и LLM). Их же использует
// детерминированный stub (llm/providers/stub-call.ts) и запасной вопрос, когда модель не ответила.
import type { AnswerSignal, QuestionLevel } from './types';

/** Лимиты квалифицирующего созвона (ADR 0003: 4–6 вопросов). */
export const CALL_LIMITS = {
  minQuestions: 4,
  maxQuestions: 6,
  /** На одну тему — не больше стольких вопросов. */
  maxPerTopic: 2,
  /** Тем в плане созвона. */
  maxTopics: 5,
  /** ПРЕДЛОЖЕНИЕ: созвонов на кандидата в сутки (защита платного LLM/TTS от цикла). */
  maxPerDay: 5,
} as const;

/** Тема для проверки: из утверждений профиля или ключевая тема специализации. */
export interface TopicSeed {
  topic: string;
  catalogId: string | null;
  /** Формулировка утверждения кандидата (null — тема от платформы, не заявлена кандидатом). */
  claimStatement: string | null;
  /** Короткий факт из резюме (цитата утверждения), если есть. Оценщику не передаётся. */
  resumeFact: string | null;
}

export interface PlanTurn {
  question: string;
  answer: string | null;
  topic: string;
  catalogId: string | null;
  level: QuestionLevel;
}

/** Стартовый уровень: заявленный middle — с рабочего вопроса, junior — с базового. */
export function startLevel(grade: 'junior' | 'middle' | null | undefined): QuestionLevel {
  return grade === 'middle' ? 2 : 1;
}

/** После сильного ответа — глубже, после слабого — проще, без ответа — тот же уровень. */
export function routeLevel(prev: QuestionLevel, signal: AnswerSignal): QuestionLevel {
  if (signal === 'strong') return Math.min(3, prev + 1) as QuestionLevel;
  if (signal === 'weak') return Math.max(1, prev - 1) as QuestionLevel;
  return prev;
}

const DONT_KNOW_RE = /(не\s+знаю|не\s+помню|не\s+сталкивал|не\s+уверен|без\s+понятия|затрудняюсь)/i;

/**
 * Эвристика сигнала для stub и запасного пути (без модели): пусто, «не знаю», очень коротко — слабый;
 * развёрнутый ответ — сильный; остальное — без сдвига. Не оценка: в вердикт не попадает.
 */
export function heuristicSignal(answer: string | null): AnswerSignal {
  if (answer === null) return 'none';
  const t = answer.replace(/\s+/g, ' ').trim();
  if (t.length < 40 || (DONT_KNOW_RE.test(t) && t.length < 160)) return 'weak';
  if (t.length >= 160) return 'strong';
  return 'none';
}

export interface PlannedQuestion {
  topicIndex: number;
  level: QuestionLevel;
  signal: AnswerSignal | null;
  /** true — переход к новой теме. */
  switched: boolean;
}

/**
 * Следующая тема и уровень по истории (сигнал — от модели или эвристики).
 * Остаёмся на теме, пока ответы сильные и уровень 3 не пройден; после слабого ответа на уровне 1,
 * после вопроса уровня 3 или после maxPerTopic вопросов — следующая непроверенная тема со стартового уровня.
 */
export function planNext(args: {
  topics: readonly TopicSeed[];
  turns: readonly PlanTurn[];
  grade: 'junior' | 'middle' | null | undefined;
  signal: AnswerSignal | null;
}): PlannedQuestion {
  const { topics, turns, grade } = args;
  const base = startLevel(grade);
  const last = turns[turns.length - 1];
  if (!last || topics.length === 0) return { topicIndex: 0, level: base, signal: null, switched: turns.length > 0 };
  const signal = args.signal ?? 'none';
  const curIdx = Math.max(0, topics.findIndex((t) => t.topic === last.topic));
  const onTopic = turns.filter((t) => t.topic === last.topic).length;
  const leave = onTopic >= CALL_LIMITS.maxPerTopic || last.level === 3 || (signal === 'weak' && last.level === 1);
  if (!leave) return { topicIndex: curIdx, level: routeLevel(last.level, signal), signal, switched: false };
  const asked = new Set(turns.map((t) => t.topic));
  const fresh = topics.findIndex((t) => !asked.has(t.topic));
  const nextIdx = fresh === -1 ? (curIdx + 1) % topics.length : fresh;
  // Новая тема — со стартового уровня, но после слабого ответа не выше базового+0.
  const level = signal === 'weak' ? (Math.max(1, base - 1) as QuestionLevel) : base;
  return { topicIndex: nextIdx, level, signal, switched: true };
}

function short(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Запасной вопрос по уровню: формулировка от темы, тип вопроса фиксирован. */
export function templateQuestion(topic: TopicSeed, level: QuestionLevel, first: boolean): string {
  const hello = first ? 'Привет! Я ИИ-интервьюер платформы, задам несколько вопросов по твоей специализации. ' : '';
  const fact = first && topic.resumeFact ? `В профиле у тебя: «${short(topic.resumeFact, 140)}». ` : '';
  const name = topic.topic;
  if (level === 1) return `${hello}${fact}Начнём с основ: что такое «${name}» и зачем это нужно в работе? Объясни своими словами.`;
  if (level === 2) return `${hello}${fact}Расскажи про «${name}» на практике: что конкретно ты делал сам и как это было устроено внутри?`;
  return `${hello}${fact}Копнём глубже в «${name}»: почему именно так, какие были альтернативы, чем пришлось заплатить и где этот подход перестаёт работать?`;
}

/** Последняя реплика ИИ при завершении (без LLM). */
export const CLOSING_LINE =
  'Спасибо, на этом вопросы закончились. Нажми «Завершить» — отдельный оценщик разберёт ответы, и карта глубины появится в профиле.';
