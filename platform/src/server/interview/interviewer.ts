// Интервьюер ИИнтервью: следующий вопрос по Zod-схеме. Блок, компетенцию и уровень выбирает код (plan.ts)
// по сигналу модели о последнем ответе; модель формулирует вопрос. Модель недоступна или вернула мусор →
// вопрос из шаблона по фокусу компетенции: интервью не падает из-за LLM на середине.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { Grade } from '../../lib/grades';
import { retellsProfile } from '../call/evaluator';
import { asksForAnswer, heuristicSignal, INTERVIEWER_TIMEOUT_MS, REFUSAL_LINE, REFUSED_RE } from '../call/plan';
import { type InterviewerStream, QuestionGate } from '../call/stream';
import { contextBlock } from '../call/prompt-utils';
import { ANSWER_SIGNALS, type AiUtteranceMeta, type AnswerSignal, type QuestionLevel } from '../call/types';
import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { type BlockId, type CompetencyDef, blockDef, gradeForLevel } from './model';
import { type BlockPlan, INTERVIEW_CLOSING_LINE, INTERVIEW_LIMITS, type InterviewTurn, type PlannedInterviewQuestion, planInterviewNext, templateInterviewQuestion } from './plan';
import type { TestHint } from './context';

export const InterviewerOutput = z.object({
  answerSignal: z.enum(ANSWER_SIGNALS),
  competencyId: z.string().min(2).max(80),
  question: z.string().min(10).max(700),
  done: z.boolean(),
});
export type InterviewerOutput = z.infer<typeof InterviewerOutput>;

const JSON_SCHEMA = responseJsonSchema(InterviewerOutput) as object;

/** Версия промпта interviewer.md (аудит промптов 12.10: v2 — один вопрос за реплику, род кандидата, отказ на «сколько баллов»). */
export const INTERVIEW_PROMPT_VERSION = 'interview-interviewer-v2';

let promptCache: string | null = null;
export function loadInterviewPrompt(): string {
  if (promptCache === null) promptCache = readFileSync(path.join(process.cwd(), 'src/server/interview/prompts', 'interviewer.md'), 'utf8');
  return promptCache;
}

export interface InterviewerInput {
  specialization: string;
  subcategoryId: string | null;
  claimedGrade: Grade | null;
  plan: BlockPlan;
  testHints: readonly TestHint[];
  /** Тексты профиля, которые нельзя пересказывать в вопросе. */
  resumeFacts: readonly string[];
  turns: InterviewTurn[];
  limits: { minQuestions: number; maxQuestions: number };
  /** Дополнительный вопрос по компетенции с расхождением оценщика: компетенция и уровень заданы. */
  force?: { competency: CompetencyDef; block: BlockId; level: QuestionLevel };
}

export interface PlannedPayload {
  block: BlockId;
  competencyId: string;
  title: string;
  level: number;
  focus: string;
  done: boolean;
}

/** Данные для модели: тот же JSON разбирает stub (llm/providers/stub-interview.ts). */
export interface InterviewerPayload {
  specialization: string;
  subcategoryId: string | null;
  claimedGrade: string | null;
  blocks: { id: BlockId; title: string; competencies: { id: string; title: string; test?: { wrong: number; right: number } }[] }[];
  turns: { n: number; block: BlockId; competencyId: string; level: number; question: string; answer: string | null; interrupted?: { heardSentences: number; unspokenTail: string } }[];
  next: {
    questionNumber: number;
    minQuestions: number;
    maxQuestions: number;
    /** Что задать в зависимости от сигнала по последнему ответу. */
    ifStrong: PlannedPayload;
    ifWeak: PlannedPayload;
    ifNone: PlannedPayload;
    /** Дополнительный вопрос: компетенция и уровень заданы кодом (ifStrong/ifWeak/ifNone одинаковы). */
    probe?: boolean;
  };
}

function toPayload(p: PlannedInterviewQuestion): PlannedPayload {
  return { block: p.block, competencyId: p.competency.id, title: p.competency.title, level: p.level, focus: p.competency.focus[gradeForLevel(p.level)], done: p.done };
}

/** План по сигналу (или принудительный дополнительный вопрос). */
export function plannedFor(input: InterviewerInput, signal: AnswerSignal | null): PlannedInterviewQuestion {
  if (input.force) return { block: input.force.block, competency: input.force.competency, level: input.force.level, signal, done: false };
  return planInterviewNext({ plan: input.plan, turns: input.turns, grade: input.claimedGrade, signal, maxQuestions: input.limits.maxQuestions });
}

export function buildInterviewerPayload(input: InterviewerInput): InterviewerPayload {
  const hints = new Map(input.testHints.map((h) => [h.competencyId, h]));
  const blocks = (['intro', 'test', 'systems', 'team'] as const).map((id) => ({
    id,
    title: blockDef(id).title,
    competencies: input.plan[id].map((c) => {
      const h = hints.get(c.id);
      return { id: c.id, title: c.title, ...(h ? { test: { wrong: h.wrong, right: h.right } } : {}) };
    }),
  }));
  const hasAnswer = input.turns.length > 0;
  return {
    specialization: input.specialization,
    subcategoryId: input.subcategoryId,
    claimedGrade: input.claimedGrade,
    blocks,
    turns: input.turns.map((t, i) => ({
      n: i + 1,
      block: t.block,
      competencyId: t.competencyId,
      level: t.level,
      question: t.question,
      answer: t.answer,
      ...(t.interrupted ? { interrupted: { heardSentences: t.interrupted.heardSentences, unspokenTail: t.interrupted.tail } } : {}),
    })),
    next: {
      questionNumber: input.turns.length + 1,
      minQuestions: input.limits.minQuestions,
      maxQuestions: input.limits.maxQuestions,
      ifStrong: toPayload(plannedFor(input, hasAnswer ? 'strong' : null)),
      ifWeak: toPayload(plannedFor(input, hasAnswer ? 'weak' : null)),
      ifNone: toPayload(plannedFor(input, hasAnswer ? 'none' : null)),
      ...(input.force ? { probe: true } : {}),
    },
  };
}

export function buildInterviewerMessages(input: InterviewerInput, correction?: string): ChatMessage[] {
  const payload = buildInterviewerPayload(input);
  const n = payload.next.questionNumber;
  const instruction = input.force
    ? `Задай дополнительный вопрос №${n} по компетенции «${input.force.competency.title}» уровня ${input.force.level}: по ответам пока нельзя понять глубину. Спроси о другой стороне компетенции, не повторяя заданные вопросы. answerSignal — по последнему ответу.`
    : n === 1
      ? 'Задай первый вопрос: короткое приветствие, фраза про четыре блока и вопрос по next.ifNone.'
      : 'Задай следующий вопрос: сначала answerSignal по последнему ответу, затем вопрос по плану для этого сигнала (next.ifStrong / next.ifWeak / next.ifNone): его block, competencyId, level и focus. Если план говорит block = summary — верни done: true.';
  const msgs: ChatMessage[] = [{ role: 'user', content: `${contextBlock(payload)}\n\n${instruction} Ответ — только JSON по схеме.` }];
  if (correction) msgs.push({ role: 'user', content: correction });
  return msgs;
}

const INVALID_CORRECTION =
  'Ответ не прошёл схему: нужен JSON с полями answerSignal, competencyId, question (по-русски, 10–700 символов), done. Верни JSON заново.';
const OFF_PLAN_CORRECTION =
  'competencyId не совпадает с планом для твоего answerSignal (next.ifStrong / next.ifWeak / next.ifNone): возьми competencyId, block и level из плана и верни JSON заново.';
const REPEAT_CORRECTION =
  'Этот вопрос уже звучал в интервью почти дословно — кандидат решит, что его не услышали. Задай новый вопрос по плану: другая сторона компетенции или следующий шаг той же задачи, своими словами. Верни JSON заново.';

/**
 * Кандидат выпрашивает оценку или «прав ли я» — дополнение к asksForAnswer (call/plan.ts): там «Сколько у меня сейчас
 * баллов?» и «Я прав был?» не ловятся (аудит 12.10: модель в обоих прогонах промолчала).
 */
const ASKS_MORE_RE = /(сколько[^.?!]{0,25}балл|как(ая|ой)[^.?!]{0,20}(оценк|балл)[^.?!]{0,15}(у меня|мне)|(?<![а-яё])я[^.?!]{0,10}прав(?![а-яё])|прав(а)? ли я|правильно ли я|я (был|была) прав)/i;
export function asksForAnswerAll(answer: string | null | undefined): boolean {
  return asksForAnswer(answer) || Boolean(answer && ASKS_MORE_RE.test(answer));
}
function withRefusalAll(question: string, answer: string | null | undefined): string {
  return asksForAnswerAll(answer) && !REFUSED_RE.test(question) ? `${REFUSAL_LINE} ${question}` : question;
}

/** Одобрение в начале реплики («Хорошо.», «Отлично!») — оценщик читает его как оценку. */
const PRAISE_LEAD_RE = /^\s*(хорошо|отлично|супер|класс|здорово|прекрасно|замечательно|верно|правильно)\s*[.,!—–-]+\s*/i;
export function stripPraise(q: string): string {
  const t = q.replace(PRAISE_LEAD_RE, '');
  return t === q || t.length < 10 ? q : t.charAt(0).toUpperCase() + t.slice(1);
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/…\([^)]*\)/g, ' ').replace(/[^а-яa-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Вопрос повторяет уже заданный: общий отрезок из 8 слов подряд с прошлым вопросом (по услышанному тексту). */
export function repeatsAsked(question: string, turns: readonly { question: string }[], n = 8): boolean {
  const q = words(question);
  if (q.length < n) return false;
  const grams = new Set<string>();
  for (let i = 0; i + n <= q.length; i++) grams.add(q.slice(i, i + n).join(' '));
  return turns.some((t) => {
    const w = words(t.question);
    for (let i = 0; i + n <= w.length; i++) if (grams.has(w.slice(i, i + n).join(' '))) return true;
    return false;
  });
}

const RETELL_CORRECTION =
  'Вопрос повторяет текст из профиля кандидата — так нельзя: транскрипт читает слепой оценщик. Переформулируй вопрос своими словами, не повторяя ни одной фразы профиля, и верни JSON заново.';

export interface NextInterviewQuestion {
  question: string;
  meta: AiUtteranceMeta;
  /** Блоки пройдены: код выдаст закрывающую реплику. */
  done: boolean;
}

function metaOf(p: PlannedInterviewQuestion, routed: AnswerSignal | null, extra: Partial<AiUtteranceMeta> = {}): AiUtteranceMeta {
  return { topic: p.competency.title, catalogId: null, level: p.level, routedBy: routed, competencyId: p.competency.id, block: p.block, ...extra };
}

/** Ворота потокового режима (call/stream.ts): компетенцию по плану проверяем до первого предложения. */
function interviewGate(input: InterviewerInput, titles: readonly string[], stream: InterviewerStream, onPlan: (p: { planned: PlannedInterviewQuestion; meta: AiUtteranceMeta }) => void): QuestionGate {
  const lastAnswer = input.turns[input.turns.length - 1]?.answer ?? null;
  let closingTurn = false;
  return new QuestionGate({
    field: 'question',
    ready(f) {
      if (typeof f.competencyId !== 'string') return 'wait';
      if (input.turns.length && typeof f.answerSignal !== 'string') return 'wait';
      const routed: AnswerSignal | null = input.turns.length ? (f.answerSignal as AnswerSignal) : null;
      const planned = plannedFor(input, routed);
      if (f.competencyId.trim() !== planned.competency.id) return 'stop';
      // План закончился (summary), а минимум набран — сервис заменит вопрос итогом: заранее не озвучиваем.
      if (planned.done && stream.closable) return 'stop';
      closingTurn = planned.done;
      onPlan({ planned, meta: metaOf(planned, routed, input.force ? { probe: 'inconclusive', fallback: false } : {}) });
      return 'ok';
    },
    // Одобрение в начале и повтор прошлого вопроса не озвучиваем по частям: вопрос уйдёт целиком после проверок.
    textOk: (q) => /[а-яё]/i.test(q) && !retellsProfile(q, input.resumeFacts, titles) && !PRAISE_LEAD_RE.test(q) && !repeatsAsked(q, input.turns),
    lead: (first) => (!closingTurn && asksForAnswerAll(lastAnswer) && !REFUSED_RE.test(first) ? REFUSAL_LINE : null),
    onSentence: stream.onSentence,
  });
}

export async function nextInterviewQuestion(input: InterviewerInput, llm: LlmProvider, signal?: AbortSignal, stream?: InterviewerStream): Promise<NextInterviewQuestion> {
  const lastAnswer = input.turns[input.turns.length - 1]?.answer ?? null;
  const titles = Object.values(input.plan).flat().map((c) => c.title);
  let streamPlan: { planned: PlannedInterviewQuestion; meta: AiUtteranceMeta } | null = null;
  // План закончился при любом сигнале — вопрос модели всё равно заменится итоговой репликой (service.closeOrReview):
  // не тратим вызов LLM (≈1–2 с тишины в конце интервью) и не рискуем озвучить её «интервью окончено, удачи».
  if (!input.force && input.turns.length > 0 && (['strong', 'weak', 'none'] as const).every((sig) => plannedFor(input, sig).done)) {
    const routed = heuristicSignal(lastAnswer);
    return { question: INTERVIEW_CLOSING_LINE, meta: metaOf(plannedFor(input, routed), routed), done: true };
  }
  const gate = stream ? interviewGate(input, titles, stream, (p) => (streamPlan = p)) : null;
  let correction: string | undefined;
  try {
    // В потоковом режиме повтор — только пока ничего не прозвучало (gate.started).
    for (let attempt = 0; attempt < 2 && !gate?.started; attempt++) {
      gate?.reset();
      const res = await llm.complete(
        {
          purpose: 'interview_interviewer', timeoutMs: INTERVIEWER_TIMEOUT_MS,
          system: loadInterviewPrompt(),
          messages: buildInterviewerMessages(input, correction),
          schema: { name: 'interview_question', jsonSchema: JSON_SCHEMA },
          temperature: 0.4,
          maxTokens: 500,
          ...(gate ? { onJsonDelta: (c: string) => gate.push(c) } : {}),
        },
        signal,
      );
      const parsed = InterviewerOutput.safeParse(res.kind === 'json' ? res.json : undefined);
      // Невалидный вывод — одна повторная попытка с подсказкой, затем шаблон.
      if (!parsed.success || !/[а-яё]/i.test(parsed.data.question)) {
        correction = INVALID_CORRECTION;
        continue;
      }
      const out = parsed.data;
      const routed: AnswerSignal | null = input.turns.length ? out.answerSignal : null;
      const planned = plannedFor(input, routed);
      // Компетенцию держит код: вопрос не по плану — переформулировка, затем шаблон.
      if (out.competencyId.trim() !== planned.competency.id) {
        correction = OFF_PLAN_CORRECTION;
        continue;
      }
      if (retellsProfile(out.question, input.resumeFacts, titles)) {
        correction = RETELL_CORRECTION;
        continue;
      }
      if (!planned.done && repeatsAsked(out.question, input.turns)) {
        correction = REPEAT_CORRECTION;
        continue;
      }
      out.question = stripPraise(out.question.trim());
      const composed = gate?.compose(out.question, '');
      if (planned.done) {
        if (composed?.usedChosen) return { question: composed.text, meta: metaOf(planned, routed), done: true };
        if (gate?.started) break;
        return { question: out.question.trim(), meta: metaOf(planned, routed), done: true };
      }
      const meta = metaOf(planned, routed, input.force ? { probe: 'inconclusive', fallback: false } : {});
      if (composed?.usedChosen) return { question: composed.text, meta, done: false };
      if (gate?.started) break; // прозвучало не то, что вышло в итоге — собираем ниже из прозвучавшего
      return { question: withRefusalAll(out.question.trim(), lastAnswer), meta, done: false };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[interview] interviewer fallback:', err instanceof Error ? err.message : err);
  }
  const routed = input.turns.length ? heuristicSignal(lastAnswer) : null;
  const planned = plannedFor(input, routed);
  const first = input.turns.length === 0;
  const template = templateInterviewQuestion(planned.competency, planned.block === 'summary' ? 'test' : planned.block, planned.level, first);
  const fbMeta = metaOf(planned, routed, { fallback: true, ...(input.force ? { probe: 'inconclusive' as const } : {}) });
  // Часть вопроса уже прозвучала: реплика = прозвучавшее (+ шаблон без второй вводной, если вопроса в нём нет).
  if (gate?.started) {
    const c = gate.compose(null, template)!;
    const sp = streamPlan as { planned: PlannedInterviewQuestion; meta: AiUtteranceMeta } | null;
    console.warn('[interview] interviewer stream cut:', c.cut ? 'heard question kept' : 'template appended');
    if (c.cut && sp) return { question: c.text, meta: { ...sp.meta, streamCut: true }, done: false };
    return { question: c.text, meta: { ...fbMeta, streamCut: true }, done: false };
  }
  return { question: withRefusalAll(template, lastAnswer), meta: fbMeta, done: planned.done };
}

export { INTERVIEW_LIMITS };
