// Маршрут интервьюера по уровню и выбор темы — чистые функции (без БД и LLM). Их же использует
// детерминированный stub (llm/providers/stub-call.ts) и запасной вопрос, когда модель не ответила.
import type { AnswerSignal, QuestionLevel } from './types';
import type { Grade } from '../../lib/grades';

/** Лимиты квалифицирующего созвона (ADR 0003: 4–6 вопросов; до 8 — с дополнительными по неопределённым темам). */
export const CALL_LIMITS = {
  minQuestions: 4,
  maxQuestions: 6,
  /** Потолок с дополнительными вопросами по темам, где прогоны оценщика разошлись (status=inconclusive). */
  hardMaxQuestions: 8,
  /** На одну тему — не больше стольких вопросов. */
  maxPerTopic: 2,
  /** Тем в плане созвона. */
  maxTopics: 5,
  /** Запусков оценщика на созвон (первый + повторы после 503); исчерпаны — созвон закрывается без оценки. */
  maxFinishAttempts: 3,
  /**
   * Реплик ИИ на созвон всего (решение владельца 11.10): обычные вопросы, этап разбора теста, дополнительные
   * вопросы и одна итоговая реплика. Повтор итоговой после дополнительного вопроса не считается.
   */
  maxAiTurns: 8,
  /** ПРЕДЛОЖЕНИЕ: созвонов на кандидата в сутки (защита платного LLM/TTS от цикла). */
} as const;

/**
 * Таймаут одного вызова интервьюера (вопрос созвона, вопрос разбора теста, ИИнтервью). Кандидат ждёт в тишине:
 * дольше 20 с — лучше запасной вопрос из шаблона, чем общий LLM_TIMEOUT_MS (40 с; с повтором после пересказа — 80 с).
 * Живой замер 11.10: обычный ход 1–3 с.
 */
export const INTERVIEWER_TIMEOUT_MS = 20_000;

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

/** Стартовый уровень: заявленный middle — с рабочего вопроса, senior — с глубокого, junior — с базового. */
export function startLevel(grade: Grade | null | undefined): QuestionLevel {
  return grade === 'senior' ? 3 : grade === 'middle' ? 2 : 1;
}

/** После сильного ответа — глубже, после слабого — проще, без ответа — тот же уровень. */
export function routeLevel(prev: QuestionLevel, signal: AnswerSignal): QuestionLevel {
  if (signal === 'strong') return Math.min(3, prev + 1) as QuestionLevel;
  if (signal === 'weak') return Math.max(1, prev - 1) as QuestionLevel;
  return prev;
}

const DONT_KNOW_RE = /(не\s+знаю|не\s+помню|не\s+сталкивал|не\s+уверен|без\s+понятия|затрудняюсь)/i;

/**
 * Кандидат прямо сказал, что не знает (коротко, без попытки рассуждать). Такой ответ не штрафуется как ложь,
 * но закрывает тему: переспрашивать то же глубже или проще — давить, вопрос уходит на другую тему.
 */
export function saysDontKnow(answer: string | null | undefined): boolean {
  if (!answer) return false;
  const t = answer.replace(/\s+/g, ' ').trim();
  return t.length < 160 && DONT_KNOW_RE.test(t);
}

const ASKS_ANSWER_RE =
  /(подскаж|правильн\S* ответ|верн\S* ответ|какой ответ ты|что ты хочешь услышать|что нужно ответить|как(ая|ую|ой) [^.?!]{0,25}(оценк|балл)|сколько (у меня )?балл|поставь (мне )?(высш|максим|2|5)|скажи,? (я )?(прав|верно))/i;
const REFUSED_RE = /(не могу подсказ|подсказать не могу|не подскажу|не могу сказать оценк|оценку не (говорю|называю))/i;

/** Кандидат пытается выведать эталон, оценку или «что хотят услышать». */
export function asksForAnswer(answer: string | null | undefined): boolean {
  return Boolean(answer && ASKS_ANSWER_RE.test(answer));
}

/** Вежливый отказ одной фразой (если модель сама не отказала) — перед следующим вопросом. */
export const REFUSAL_LINE = 'Подсказать не могу — ответы разбирает отдельный оценщик.';

export function withRefusal(question: string, answer: string | null | undefined, line = REFUSAL_LINE): string {
  return asksForAnswer(answer) && !REFUSED_RE.test(question) ? `${line} ${question}` : question;
}

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

/**
 * Покрытие тем: сколько вопросов осталось (включая следующий) и какие темы ещё не спрошены. Если
 * непроверенных тем не меньше, чем оставшихся вопросов, следующий вопрос обязан открыть новую тему —
 * иначе заявленная тема в конце списка не спрашивается никогда (валидация 10.10: покрытие 75 %).
 */
export function coverage(topics: readonly TopicSeed[], turns: readonly PlanTurn[], maxQuestions: number): { remaining: number; unprobed: string[]; mustSwitch: boolean } {
  const asked = new Set(turns.map((t) => t.topic));
  const unprobed = topics.filter((t) => !asked.has(t.topic)).map((t) => t.topic);
  const remaining = Math.max(0, maxQuestions - turns.length);
  return { remaining, unprobed, mustSwitch: turns.length > 0 && unprobed.length > 0 && unprobed.length >= remaining };
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
  grade: Grade | null | undefined;
  signal: AnswerSignal | null;
  /** Лимит вопросов для правила покрытия (по умолчанию CALL_LIMITS.maxQuestions). */
  maxQuestions?: number;
}): PlannedQuestion {
  const { topics, turns, grade } = args;
  const base = startLevel(grade);
  const last = turns[turns.length - 1];
  if (!last || topics.length === 0) return { topicIndex: 0, level: base, signal: null, switched: turns.length > 0 };
  const signal = args.signal ?? 'none';
  const curIdx = Math.max(0, topics.findIndex((t) => t.topic === last.topic));
  const onTopic = turns.filter((t) => t.topic === last.topic).length;
  const cov = coverage(topics, turns, args.maxQuestions ?? CALL_LIMITS.maxQuestions);
  const leave = cov.mustSwitch || onTopic >= CALL_LIMITS.maxPerTopic || last.level === 3 || (signal === 'weak' && last.level === 1) || saysDontKnow(last.answer);
  if (!leave) return { topicIndex: curIdx, level: routeLevel(last.level, signal), signal, switched: false };
  const asked = new Set(turns.map((t) => t.topic));
  const fresh = topics.findIndex((t) => !asked.has(t.topic));
  const nextIdx = fresh === -1 ? (curIdx + 1) % topics.length : fresh;
  // Новая тема — со стартового уровня, но после слабого ответа не выше базового+0.
  const level = signal === 'weak' ? (Math.max(1, base - 1) as QuestionLevel) : base;
  return { topicIndex: nextIdx, level, signal, switched: true };
}

/**
 * Запасной вопрос по уровню: формулировка от темы, тип вопроса фиксирован. Название темы — формулировка каталога
 * («Проверял права доступа…»), поэтому она идёт отдельной цитатой, а не в «что такое …» (было неграмотно).
 */
export function templateQuestion(topic: TopicSeed, level: QuestionLevel, first: boolean): string {
  const hello = first ? 'Привет! Это Кира, задам несколько вопросов по твоей специализации. ' : '';
  // Конкретику резюме в вопрос не вставляем: транскрипт читает слепой оценщик (ADR 0003).
  const fact = first && topic.claimStatement ? 'Эта тема есть у тебя в профиле. ' : '';
  const name = topic.topic.replace(/[.\s]+$/, '');
  if (level === 1) return `${hello}${fact}Тема: «${name}». Объясни своими словами, что здесь главное и зачем это нужно в работе.`;
  if (level === 2) return `${hello}${fact}Тема: «${name}». Как это было устроено у тебя на практике и какая часть была на тебе?`;
  return `${hello}${fact}Копнём глубже в тему «${name}»: почему именно так, какие были альтернативы, чем пришлось заплатить и где этот подход перестаёт работать?`;
}

/** Последняя реплика ИИ при завершении (без LLM). */
export const CLOSING_LINE =
  'Спасибо, на этом вопросы закончились. Нажми «Завершить» — отдельный оценщик разберёт ответы, и карта глубины появится в профиле.';

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
};

/**
 * Итоговая реплика с кратким итогом для кандидата: сколько тем прошли и был ли разбор задания теста. Оценок не
 * называет (их ставит слепой оценщик после «Завершить»). `base` — закрывающая реплика вида созвона; её первое
 * предложение заменяется итогом, остальное (что делать дальше) сохраняется.
 */
export function closingWithRecap(base: string, recap: { topics: number; testReview: boolean }): string {
  if (recap.topics === 0) return base;
  const tail = base.replace(/^[^.!]*[.!]\s*/, '');
  const what = `${recap.topics} ${plural(recap.topics, 'тему', 'темы', 'тем')}${recap.testReview ? ' и разобрали задание из теста' : ''}`;
  return `Спасибо, на этом всё: мы прошли ${what}. ${tail}`.trim();
}

