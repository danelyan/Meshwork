// Интервьюер квалифицирующего созвона: следующий вопрос по Zod-схеме. Ничего не оценивает —
// только сигнал маршрута (сильный/слабый ответ), уровень вопроса считает код (plan.ts).
// Модель недоступна или вернула мусор → вопрос из шаблона: созвон не падает из-за LLM на середине.
import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { retellsProfile } from './evaluator';
import { CALL_LIMITS, coverage, type PlanTurn, type TopicSeed, heuristicSignal, planNext, routeLevel, saysDontKnow, startLevel, templateQuestion, withRefusal, INTERVIEWER_TIMEOUT_MS } from './plan';
import { contextBlock, loadCallPrompt } from './prompt-utils';
import { CallInterviewerOutput } from './schemas';
import type { AiUtteranceMeta, AnswerSignal, QuestionLevel } from './types';
import type { Grade } from '../../lib/grades';

const JSON_SCHEMA = responseJsonSchema(CallInterviewerOutput) as object;

export interface InterviewerInput {
  specialization: string;
  claimedGrade: Grade | null;
  topics: TopicSeed[];
  turns: PlanTurn[];
  /** Сколько вопросов уже задано и лимиты — модели для `done`. */
  limits: { minQuestions: number; maxQuestions: number };
  /** Дополнительный вопрос по теме с расхождением оценщика (status=inconclusive): тема и уровень заданы. */
  force?: { topic: string; level: QuestionLevel };
}

/** Данные для модели: тот же JSON разбирает stub (llm/providers/stub-call.ts). */
export interface InterviewerPayload {
  specialization: string;
  claimedGrade: string | null;
  topics: { topic: string; catalogId: string | null; claim: string | null; resumeFact: string | null }[];
  turns: { n: number; topic: string; level: number; question: string; answer: string | null }[];
  next: {
    questionNumber: number;
    /** Уровень, если остаёшься на текущей теме, по сигналу. */
    levelIfStrong: number;
    levelIfWeak: number;
    levelIfNone: number;
    /** Уровень первого вопроса новой темы. */
    startLevel: number;
    /** Темы, по которым уже задано maxPerTopic вопросов: по ним больше не спрашивать. */
    closedTopics: string[];
    /** Ещё не спрошенные темы (по порядку приоритета) и сколько вопросов осталось. */
    unprobedTopics: string[];
    remainingQuestions: number;
    /** true — следующий вопрос обязан открыть тему из unprobedTopics (иначе она останется непроверенной). */
    mustSwitch: boolean;
    /** Дополнительный вопрос: тема и уровень заданы кодом. */
    probeTopic?: string;
    probeLevel?: number;
    minQuestions: number;
    maxQuestions: number;
  };
}

export function buildPayload(input: InterviewerInput): InterviewerPayload {
  const last = input.turns[input.turns.length - 1];
  const base = startLevel(input.claimedGrade);
  const prev: QuestionLevel = last?.level ?? base;
  const cov = coverage(input.topics, input.turns, input.limits.maxQuestions);
  const closed = [...new Set(input.turns.map((t) => t.topic))].filter(
    (t) => input.turns.filter((x) => x.topic === t).length >= CALL_LIMITS.maxPerTopic || (last?.topic === t && saysDontKnow(last.answer)),
  );
  return {
    specialization: input.specialization,
    claimedGrade: input.claimedGrade,
    topics: input.topics.map((t) => ({ topic: t.topic, catalogId: t.catalogId, claim: t.claimStatement, resumeFact: t.resumeFact })),
    turns: input.turns.map((t, i) => ({ n: i + 1, topic: t.topic, level: t.level, question: t.question, answer: t.answer })),
    next: {
      questionNumber: input.turns.length + 1,
      levelIfStrong: last ? routeLevel(prev, 'strong') : base,
      levelIfWeak: last ? routeLevel(prev, 'weak') : base,
      levelIfNone: prev,
      startLevel: base,
      closedTopics: input.force ? closed.filter((t) => t !== input.force!.topic) : closed,
      unprobedTopics: cov.unprobed,
      remainingQuestions: cov.remaining,
      mustSwitch: !input.force && cov.mustSwitch,
      ...(input.force ? { probeTopic: input.force.topic, probeLevel: input.force.level } : {}),
      minQuestions: input.limits.minQuestions,
      maxQuestions: input.limits.maxQuestions,
    },
  };
}

export function buildInterviewerMessages(input: InterviewerInput, correction?: string): ChatMessage[] {
  const n = input.turns.length + 1;
  const payload = buildPayload(input);
  const instruction = input.force
    ? `Задай дополнительный вопрос №${n} по теме «${input.force.topic}» уровня ${input.force.level} (next.probeTopic): по ответам пока нельзя понять глубину. Спроси о другой стороне темы, чем раньше, не повторяя заданные вопросы. answerSignal — по последнему ответу.`
    : n === 1
      ? 'Задай первый вопрос: короткое приветствие и вопрос по первой теме уровня next.startLevel.'
      : `Задай вопрос №${n}: сначала answerSignal по последнему ответу, затем вопрос нужного уровня (levelIfStrong / levelIfWeak / levelIfNone; новая тема — startLevel).${
          payload.next.mustSwitch ? ` Обязательно перейди к новой теме — первой из next.unprobedTopics («${payload.next.unprobedTopics[0]}»), иначе она останется непроверенной.` : ''
        }`;
  const msgs: ChatMessage[] = [{ role: 'user', content: `${contextBlock(payload)}\n\n${instruction} Ответ — только JSON по схеме.` }];
  if (correction) msgs.push({ role: 'user', content: correction });
  return msgs;
}

/** Тексты профиля, которые интервьюеру нельзя пересказывать в вопросе (утверждения и факты резюме). */
export function profileTexts(topics: readonly TopicSeed[]): string[] {
  return topics.flatMap((t) => [t.claimStatement, t.resumeFact]).filter((x): x is string => Boolean(x && x.trim()));
}

const RETELL_CORRECTION =
  'Вопрос повторяет формулировку из профиля кандидата (утверждение или факт резюме) — так нельзя: транскрипт читает слепой оценщик. Переформулируй вопрос о теме своими словами, не повторяя ни одной фразы профиля, и верни JSON заново.';

const DONT_KNOW_CORRECTION =
  'Кандидат ответил «не знаю» — эта тема закрыта, по ней больше не спрашивай. Задай вопрос по другой теме (первая из next.unprobedTopics, если она есть) и верни JSON заново.';

export interface NextCallQuestion {
  question: string;
  meta: AiUtteranceMeta;
  /** Модель считает, что вопросов достаточно (код соблюдает минимум). */
  done: boolean;
}

/** Уровень и тема по ответу модели: уровень всегда считает код из сигнала, не модель. */
export function resolveLevel(input: InterviewerInput, topic: string, signal: AnswerSignal): QuestionLevel {
  const last = input.turns[input.turns.length - 1];
  const base = startLevel(input.claimedGrade);
  if (!last) return base;
  if (last.topic !== topic) return signal === 'weak' ? (Math.max(1, base - 1) as QuestionLevel) : base;
  return routeLevel(last.level, signal);
}

export async function nextCallQuestion(input: InterviewerInput, llm: LlmProvider, signal?: AbortSignal): Promise<NextCallQuestion> {
  const lastAnswer = input.turns[input.turns.length - 1]?.answer ?? null;
  const banned = profileTexts(input.topics);
  const cov = coverage(input.topics, input.turns, input.limits.maxQuestions);
  let correction: string | undefined;
  try {
    // Вторая попытка — только если модель пересказала профиль (n-грамма ≥ 4 слов из утверждения/резюме).
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await llm.complete(
        {
          purpose: 'call_interviewer', timeoutMs: INTERVIEWER_TIMEOUT_MS,
          system: loadCallPrompt('interviewer'),
          messages: buildInterviewerMessages(input, correction),
          schema: { name: 'call_question', jsonSchema: JSON_SCHEMA },
          temperature: 0.4,
          maxTokens: 500,
        },
        signal,
      );
      const parsed = CallInterviewerOutput.safeParse(res.kind === 'json' ? res.json : undefined);
      // Вопрос по-русски: без кириллицы (мусор минимальной заглушки) — шаблон.
      if (!parsed.success || !/[а-яё]/i.test(parsed.data.question)) break;
      const out = parsed.data;
      const routed: AnswerSignal | null = input.turns.length ? out.answerSignal : null;
      // catalogId — только из плана: модель не может привязать тему к чужому утверждению.
      const known = input.topics.find((t) => t.topic === out.topic.trim() || (out.catalogId && t.catalogId === out.catalogId));
      const topic = known?.topic ?? out.topic.trim();
      // Код держит тему: дополнительный вопрос — только по заданной теме; при правиле покрытия — только новая тема.
      if (input.force && topic !== input.force.topic) break;
      if (!input.force && cov.mustSwitch && !cov.unprobed.includes(topic)) break;
      if (retellsProfile(out.question, banned, input.topics.map((t) => t.topic))) {
        correction = RETELL_CORRECTION;
        continue;
      }
      // «Не знаю» закрывает тему: остаться на ней можно, только если других тем нет вовсе.
      const last = input.turns[input.turns.length - 1];
      if (!input.force && last && saysDontKnow(last.answer) && topic === last.topic && input.topics.some((t) => t.topic !== last.topic)) {
        if (attempt === 0) {
          correction = DONT_KNOW_CORRECTION;
          continue;
        }
        break;
      }
      // «Достаточно» не принимается, пока остались непроверенные темы и лимит не исчерпан (покрытие тем).
      const coverOpen = cov.unprobed.length > 0 && input.turns.length < input.limits.maxQuestions;
      if (!input.force && out.done && coverOpen && !cov.unprobed.includes(topic)) break;
      const level = input.force ? input.force.level : resolveLevel(input, topic, routed ?? 'none');
      return {
        question: withRefusal(out.question.trim(), lastAnswer),
        meta: { topic, catalogId: known?.catalogId ?? null, level, routedBy: routed, ...(input.force ? { probe: 'inconclusive' as const } : {}) },
        done: input.force || coverOpen ? false : out.done,
      };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[call] interviewer fallback:', err instanceof Error ? err.message : err);
  }
  const routed = input.turns.length ? heuristicSignal(lastAnswer) : null;
  if (input.force) {
    const seed = input.topics.find((t) => t.topic === input.force!.topic) ?? { topic: input.force.topic, catalogId: null, claimStatement: null, resumeFact: null };
    return {
      question: withRefusal(templateQuestion(seed, input.force.level, false), lastAnswer),
      meta: { topic: seed.topic, catalogId: seed.catalogId, level: input.force.level, routedBy: routed, fallback: true, probe: 'inconclusive' },
      done: false,
    };
  }
  let plan = planNext({ topics: input.topics, turns: input.turns, grade: input.claimedGrade, signal: routed, maxQuestions: input.limits.maxQuestions });
  // Шаблон не повторяет уже заданный вопрос (сбой модели два хода подряд давал один и тот же текст): та же тема
  // и уровень → следующая тема, лучше не спрошенная.
  const asked = new Set(input.turns.map((t) => t.question));
  const textOf = (p: typeof plan) => templateQuestion(input.topics[p.topicIndex] ?? { topic: input.specialization, catalogId: null, claimStatement: null, resumeFact: null }, p.level, input.turns.length === 0);
  if (input.topics.length > 1 && asked.has(textOf(plan))) {
    const used = new Set(input.turns.map((t) => t.topic));
    const fresh = input.topics.findIndex((t, i) => i !== plan.topicIndex && !used.has(t.topic));
    plan = { ...plan, topicIndex: fresh >= 0 ? fresh : (plan.topicIndex + 1) % input.topics.length, level: startLevel(input.claimedGrade), switched: true };
  }
  const seed = input.topics[plan.topicIndex] ?? { topic: input.specialization, catalogId: null, claimStatement: null, resumeFact: null };
  return {
    question: withRefusal(textOf(plan), lastAnswer),
    meta: { topic: seed.topic, catalogId: seed.catalogId, level: plan.level, routedBy: routed, fallback: true },
    done: false,
  };
}
