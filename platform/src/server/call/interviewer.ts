// Интервьюер квалифицирующего созвона: следующий вопрос по Zod-схеме. Ничего не оценивает –
// только сигнал маршрута (сильный/слабый ответ), уровень вопроса считает код (plan.ts).
// Модель недоступна или вернула мусор → вопрос из шаблона: созвон не падает из-за LLM на середине.
import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { retellsProfile } from './evaluator';
import { CALL_LIMITS, coverage, type PlanTurn, type TopicSeed, asksForAnswer, heuristicSignal, planNext, REFUSAL_LINE, REFUSED_RE, routeLevel, saysDontKnow, startLevel, templateQuestion, withRefusal, withRefusal as withRefusalLine, INTERVIEWER_TIMEOUT_MS } from './plan';
import { contextBlock, loadCallPrompt } from './prompt-utils';
import { CallInterviewerOutput } from './schemas';
import { type InterviewerStream, QuestionGate } from './stream';
import type { AiUtteranceMeta, AnswerSignal, QuestionLevel } from './types';
import type { Grade } from '../../lib/grades';

const JSON_SCHEMA = responseJsonSchema(CallInterviewerOutput) as object;

export interface InterviewerInput {
  specialization: string;
  claimedGrade: Grade | null;
  topics: TopicSeed[];
  turns: PlanTurn[];
  /** Сколько вопросов уже задано и лимиты – модели для `done`. */
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
    /** true – следующий вопрос обязан открыть тему из unprobedTopics (иначе она останется непроверенной). */
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
    ? `Задай дополнительный вопрос №${n} по теме «${input.force.topic}» уровня ${input.force.level} (next.probeTopic): по ответам пока нельзя понять глубину. Спроси о другой стороне темы, чем раньше, не повторяя заданные вопросы. answerSignal – по последнему ответу.`
    : n === 1
      ? 'Задай первый вопрос: короткое приветствие и вопрос по первой теме уровня next.startLevel.'
      : `Задай вопрос №${n}: сначала answerSignal по последнему ответу, затем вопрос нужного уровня (levelIfStrong / levelIfWeak / levelIfNone; новая тема – startLevel).${
          payload.next.mustSwitch ? ` Обязательно перейди к новой теме – первой из next.unprobedTopics («${payload.next.unprobedTopics[0]}»), иначе она останется непроверенной.` : ''
        }`;
  const msgs: ChatMessage[] = [{ role: 'user', content: `${contextBlock(payload)}\n\n${instruction} Ответ – только JSON по схеме.` }];
  if (correction) msgs.push({ role: 'user', content: correction });
  return msgs;
}

/** Тексты профиля, которые интервьюеру нельзя пересказывать в вопросе (утверждения и факты резюме). */
export function profileTexts(topics: readonly TopicSeed[]): string[] {
  return topics.flatMap((t) => [t.claimStatement, t.resumeFact]).filter((x): x is string => Boolean(x && x.trim()));
}

const RETELL_CORRECTION =
  'Вопрос повторяет формулировку из профиля кандидата (утверждение или факт резюме) – так нельзя: транскрипт читает слепой оценщик. Переформулируй вопрос о теме своими словами, не повторяя ни одной фразы профиля, и верни JSON заново.';

const DONT_KNOW_CORRECTION =
  'Кандидат ответил «не знаю» – эта тема закрыта, по ней больше не спрашивай. Задай вопрос по другой теме (первая из next.unprobedTopics, если она есть) и верни JSON заново.';

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

/**
 * Ворота потокового режима для квалифицирующего созвона (stream.ts): те же правила темы, что ниже по полному
 * ответу, но по полям, пришедшим до вопроса. `onMeta` получает meta темы, когда ворота открылись.
 */
function callGate(input: InterviewerInput, stream: InterviewerStream, onMeta: (meta: AiUtteranceMeta) => void): QuestionGate {
  const lastAnswer = input.turns[input.turns.length - 1]?.answer ?? null;
  const banned = profileTexts(input.topics);
  const titles = input.topics.map((t) => t.topic);
  const cov = coverage(input.topics, input.turns, input.limits.maxQuestions);
  const coverOpen = cov.unprobed.length > 0 && input.turns.length < input.limits.maxQuestions;
  const last = input.turns[input.turns.length - 1];
  return new QuestionGate({
    field: 'question',
    ready(f) {
      if (typeof f.topic !== 'string') return 'wait';
      if (input.turns.length && typeof f.answerSignal !== 'string') return 'wait';
      const known = input.topics.find((t) => t.topic === (f.topic as string).trim() || (typeof f.catalogId === 'string' && f.catalogId && t.catalogId === f.catalogId));
      const topic = known?.topic ?? (f.topic as string).trim();
      if (input.force && topic !== input.force.topic) return 'stop';
      if (!input.force && cov.mustSwitch && !cov.unprobed.includes(topic)) return 'stop';
      if (!input.force && last && saysDontKnow(last.answer) && topic === last.topic && input.topics.some((t) => t.topic !== last.topic)) return 'stop';
      // done меняет судьбу вопроса: при открытом покрытии «достаточно» по уже спрошенной теме → шаблон; без
      // покрытия и при closable «достаточно» → итог. Пока done не пришёл, в этих случаях ждём.
      const doneMatters = !input.force && (coverOpen ? !cov.unprobed.includes(topic) : stream.closable);
      if (doneMatters) {
        if (typeof f.done !== 'boolean') return 'wait';
        if (f.done) return 'stop';
      }
      const routed: AnswerSignal | null = input.turns.length ? (f.answerSignal as AnswerSignal) : null;
      const level = input.force ? input.force.level : resolveLevel(input, topic, routed ?? 'none');
      onMeta({ topic, catalogId: known?.catalogId ?? null, level, routedBy: routed, ...(input.force ? { probe: 'inconclusive' as const } : {}) });
      return 'ok';
    },
    textOk: (q) => /[а-яё]/i.test(q) && !retellsProfile(q, banned, titles),
    lead: (first) => (asksForAnswer(lastAnswer) && !REFUSED_RE.test(first) ? REFUSAL_LINE : null),
    onSentence: stream.onSentence,
  });
}

export async function nextCallQuestion(input: InterviewerInput, llm: LlmProvider, signal?: AbortSignal, stream?: InterviewerStream): Promise<NextCallQuestion> {
  const lastAnswer = input.turns[input.turns.length - 1]?.answer ?? null;
  const banned = profileTexts(input.topics);
  const cov = coverage(input.topics, input.turns, input.limits.maxQuestions);
  let streamMeta: AiUtteranceMeta | null = null;
  const gate = stream ? callGate(input, stream, (m) => (streamMeta = m)) : null;
  let correction: string | undefined;
  try {
    // Вторая попытка – только если модель пересказала профиль (n-грамма ≥ 4 слов из утверждения/резюме).
    // В потоковом режиме – только пока ничего не прозвучало (gate.started).
    for (let attempt = 0; attempt < 2 && !gate?.started; attempt++) {
      gate?.reset();
      const res = await llm.complete(
        {
          purpose: 'call_interviewer', timeoutMs: INTERVIEWER_TIMEOUT_MS,
          system: loadCallPrompt('interviewer'),
          messages: buildInterviewerMessages(input, correction),
          schema: { name: 'call_question', jsonSchema: JSON_SCHEMA },
          temperature: 0.4,
          maxTokens: 500,
          ...(gate ? { onJsonDelta: (c: string) => gate.push(c) } : {}),
        },
        signal,
      );
      const parsed = CallInterviewerOutput.safeParse(res.kind === 'json' ? res.json : undefined);
      // Вопрос по-русски: без кириллицы (мусор минимальной заглушки) – шаблон.
      if (!parsed.success || !/[а-яё]/i.test(parsed.data.question)) break;
      const out = parsed.data;
      const routed: AnswerSignal | null = input.turns.length ? out.answerSignal : null;
      // catalogId – только из плана: модель не может привязать тему к чужому утверждению.
      const known = input.topics.find((t) => t.topic === out.topic.trim() || (out.catalogId && t.catalogId === out.catalogId));
      const topic = known?.topic ?? out.topic.trim();
      // Код держит тему: дополнительный вопрос – только по заданной теме; при правиле покрытия – только новая тема.
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
      const meta: AiUtteranceMeta = { topic, catalogId: known?.catalogId ?? null, level, routedBy: routed, ...(input.force ? { probe: 'inconclusive' as const } : {}) };
      const done = input.force || coverOpen ? false : out.done;
      const composed = gate?.compose(out.question, '');
      if (composed?.usedChosen) return { question: composed.text, meta, done };
      if (gate?.started) break; // прозвучало не то, что вышло в итоге – собираем ниже из прозвучавшего
      return { question: withRefusal(out.question.trim(), lastAnswer), meta, done };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[call] interviewer fallback:', err instanceof Error ? err.message : err);
  }
  // Часть вопроса уже прозвучала: реплика = прозвучавшее (+ шаблон, если в нём ещё нет вопроса).
  if (gate?.started) {
    // Вводная-отказ уже прозвучала (или не нужна) – к шаблону её не добавляем второй раз.
    const fb = templateFallback(input, lastAnswer, false);
    const c = gate.compose(null, fb.question)!;
    console.warn('[call] interviewer stream cut:', c.cut ? 'heard question kept' : 'template appended');
    if (c.cut && streamMeta) return { question: c.text, meta: { ...(streamMeta as AiUtteranceMeta), streamCut: true }, done: false };
    return { question: c.text, meta: { ...fb.meta, streamCut: true }, done: false };
  }
  return templateFallback(input, lastAnswer);
}

/** Вопрос из шаблона без модели (сбой, мусор, нарушение правил темы). */
function templateFallback(input: InterviewerInput, lastAnswer: string | null, refuse = true): NextCallQuestion {
  const withRefusal = (q: string, a: string | null) => (refuse ? withRefusalLine(q, a) : q);
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
