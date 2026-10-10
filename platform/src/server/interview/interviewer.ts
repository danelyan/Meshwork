// Интервьюер ИИнтервью: следующий вопрос по Zod-схеме. Блок, компетенцию и уровень выбирает код (plan.ts)
// по сигналу модели о последнем ответе; модель формулирует вопрос. Модель недоступна или вернула мусор →
// вопрос из шаблона по фокусу компетенции: интервью не падает из-за LLM на середине.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { Grade } from '../../lib/grades';
import { retellsProfile } from '../call/evaluator';
import { heuristicSignal } from '../call/plan';
import { contextBlock } from '../call/prompt-utils';
import { ANSWER_SIGNALS, type AiUtteranceMeta, type AnswerSignal, type QuestionLevel } from '../call/types';
import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { type BlockId, type CompetencyDef, blockDef, gradeForLevel } from './model';
import { type BlockPlan, INTERVIEW_LIMITS, type InterviewTurn, type PlannedInterviewQuestion, planInterviewNext, templateInterviewQuestion } from './plan';
import type { TestHint } from './context';

export const InterviewerOutput = z.object({
  answerSignal: z.enum(ANSWER_SIGNALS),
  competencyId: z.string().min(2).max(80),
  question: z.string().min(10).max(700),
  done: z.boolean(),
});
export type InterviewerOutput = z.infer<typeof InterviewerOutput>;

const JSON_SCHEMA = responseJsonSchema(InterviewerOutput) as object;

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
  turns: { n: number; block: BlockId; competencyId: string; level: number; question: string; answer: string | null }[];
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
    turns: input.turns.map((t, i) => ({ n: i + 1, block: t.block, competencyId: t.competencyId, level: t.level, question: t.question, answer: t.answer })),
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

export async function nextInterviewQuestion(input: InterviewerInput, llm: LlmProvider, signal?: AbortSignal): Promise<NextInterviewQuestion> {
  const lastAnswer = input.turns[input.turns.length - 1]?.answer ?? null;
  const titles = Object.values(input.plan).flat().map((c) => c.title);
  let correction: string | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await llm.complete(
        {
          purpose: 'interview_interviewer',
          system: loadInterviewPrompt(),
          messages: buildInterviewerMessages(input, correction),
          schema: { name: 'interview_question', jsonSchema: JSON_SCHEMA },
          temperature: 0.4,
          maxTokens: 500,
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
      if (planned.done) return { question: out.question.trim(), meta: metaOf(planned, routed), done: true };
      return { question: out.question.trim(), meta: metaOf(planned, routed, input.force ? { probe: 'inconclusive', fallback: false } : {}), done: false };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[interview] interviewer fallback:', err instanceof Error ? err.message : err);
  }
  const routed = input.turns.length ? heuristicSignal(lastAnswer) : null;
  const planned = plannedFor(input, routed);
  const first = input.turns.length === 0;
  return {
    question: templateInterviewQuestion(planned.competency, planned.block === 'summary' ? 'test' : planned.block, planned.level, first),
    meta: metaOf(planned, routed, { fallback: true, ...(input.force ? { probe: 'inconclusive' as const } : {}) }),
    done: planned.done,
  };
}

export { INTERVIEW_LIMITS };
