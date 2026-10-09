import { z } from 'zod';

import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { loadPrompt, tag } from './prompt-utils';

/**
 * Интервьюер защиты: генерирует следующий вопрос по Zod-схеме. Ничего не
 * оценивает. Модель недоступна или вернула мусор → детерминированный вопрос
 * из шаблона (защита не должна падать из-за LLM на середине).
 */

export const InterviewerOutput = z.object({
  // Вопрос по-русски: без кириллицы (мусор, «xxxxxxxxxx» минимальной заглушки) — шаблон.
  question: z.string().min(10).max(600).regex(/[а-яё]/i),
  enough: z.boolean(),
});
export type InterviewerOutput = z.infer<typeof InterviewerOutput>;

const INTERVIEWER_JSON_SCHEMA = responseJsonSchema(InterviewerOutput) as object;

export interface InterviewerContext {
  claimStatement: string;
  catalogStatement: string;
  /** Цитата из документа кандидата. */
  quote: string;
  sourceRef: string;
  /** Что утверждение не доказывает (каталог / claim.limits). */
  limits: string;
  /** Уже заданные вопросы и ответы (answer null — ещё не ответил). */
  turns: { question: string; answer: string | null }[];
}

export interface NextQuestion {
  question: string;
  enough: boolean;
  /** true — вопрос из шаблона, модель не ответила валидно. */
  fallback: boolean;
}

function truncate(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Запасные вопросы: тип вопроса фиксирован, формулировка — от утверждения. */
export function fallbackQuestion(ctx: InterviewerContext, index: number): string {
  if (index === 0) {
    return `В твоём документе написано: «${truncate(ctx.quote, 200)}». Расскажи, как именно ты это делал: что было задачей, какие решения принимал сам и как это устроено внутри?`;
  }
  const bank = [
    'Почему ты сделал именно так? Какие альтернативы рассматривал и чем пришлось заплатить за выбранный вариант?',
    'Что сломается в этом решении, если нагрузка или объём данных вырастет в 10 раз? Что бы ты поменял первым?',
    'Где граница этого подхода - в каких условиях он перестаёт работать или становится опасным?',
    'Как ты проверил, что решение работает? Что пошло не так в процессе и как ты это исправил?',
  ];
  return bank[(index - 1) % bank.length] as string;
}

export function buildInterviewerMessages(ctx: InterviewerContext): ChatMessage[] {
  const claim = [
    '<claim>',
    tag('statement', ctx.claimStatement),
    tag('catalog', ctx.catalogStatement),
    tag('quote', ctx.quote),
    tag('source_ref', ctx.sourceRef),
    tag('limits', ctx.limits),
    '</claim>',
  ].join('\n');
  const history = ctx.turns
    .map(
      (t, i) =>
        `<turn n="${i + 1}">\n${tag('question', t.question)}\n${
          t.answer === null ? '' : tag('candidate_answer', t.answer.trim() === '' ? '(нет ответа)' : t.answer)
        }\n</turn>`,
    )
    .join('\n');
  const n = ctx.turns.length + 1;
  const instruction =
    n === 1
      ? 'Задай первый вопрос — по цитате и артефакту.'
      : `Задай вопрос №${n} — адаптивно по последнему ответу кандидата.`;
  return [
    {
      role: 'user',
      content: `${claim}\n\n<history>\n${history || '(вопросов ещё не было)'}\n</history>\n\n${instruction} Ответ — только JSON по схеме.`,
    },
  ];
}

export async function nextQuestion(
  ctx: InterviewerContext,
  llm: LlmProvider,
  signal?: AbortSignal,
): Promise<NextQuestion> {
  const index = ctx.turns.length;
  try {
    const res = await llm.complete(
      {
        purpose: 'interviewer',
        system: loadPrompt('interviewer'),
        messages: buildInterviewerMessages(ctx),
        schema: { name: 'defense_question', jsonSchema: INTERVIEWER_JSON_SCHEMA },
        temperature: 0.4,
        maxTokens: 400,
      },
      signal,
    );
    const raw = res.kind === 'json' ? res.json : undefined;
    const parsed = InterviewerOutput.safeParse(raw);
    if (parsed.success) {
      return { question: parsed.data.question.trim(), enough: parsed.data.enough, fallback: false };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[defense] interviewer fallback:', err instanceof Error ? err.message : err);
  }
  return { question: fallbackQuestion(ctx, index), enough: false, fallback: true };
}
