// Zod-схемы API созвона (lane call). Генератор OpenAPI берёт их из route.ts (scripts/openapi).
import { z } from 'zod';

import { ANSWER_SIGNALS, CALL_KINDS } from './types';

/** Длина реплики кандидата: как у защиты утверждения. */
export const MAX_UTTERANCE_CHARS = 4000;

export const StartCallBody = z.object({
  kind: z.enum(CALL_KINDS).default('qualifying'),
  /** kind=defense: сабмит проекта (lane project / defense-room). */
  projectSubmissionId: z.string().min(1).max(64).optional(),
});
export type StartCallBody = z.infer<typeof StartCallBody>;

/** Реплика кандидата: текст (набран или распознан) и/или сегмент аудио из POST /api/call/{id}/audio. */
export const TurnBody = z
  .object({
    text: z.string().max(MAX_UTTERANCE_CHARS).optional(),
    audioRef: z
      .string()
      .regex(/^\d{3}\.wav$/, 'audioRef — имя сегмента из /audio')
      .optional(),
  })
  .refine((b) => (b.text?.trim().length ?? 0) > 0 || b.audioRef, { message: 'Нужен текст или audioRef' });
export type TurnBody = z.infer<typeof TurnBody>;

export const CallConsentBody = z.object({ version: z.string().min(1).max(64) });

export const CallListQuery = z.object({ kind: z.enum(CALL_KINDS).optional() });

// ---------------------------------------------------------------------------
// Выходы моделей
// ---------------------------------------------------------------------------

/**
 * Интервьюер: оценивает только маршрут (сильный/слабый ответ → глубже/проще), сам вердикт не ставит.
 * Порядок полей: сначала сигнал по прошлому ответу, затем тема и вопрос (structured output идёт по порядку схемы).
 */
export const CallInterviewerOutput = z.object({
  answerSignal: z.enum(ANSWER_SIGNALS),
  topic: z.string().min(2).max(120),
  catalogId: z.string().max(80).nullable(),
  // Вопрос по-русски: без кириллицы (мусор минимальной заглушки) — шаблон.
  question: z.string().min(10).max(600).regex(/[а-яё]/i),
  done: z.boolean(),
});
export type CallInterviewerOutput = z.infer<typeof CallInterviewerOutput>;

const Score = z.union([z.literal(0), z.literal(1), z.literal(2)]);
// Цитата → обоснование → балл: модель сначала находит опору, потом ставит число.
const Criterion = z.object({ quote: z.string().max(600), rationale: z.string().max(600), score: Score });

export const CallEvaluatorOutput = z.object({
  topics: z
    .array(
      z.object({
        topic: z.string().max(120),
        depth: Criterion,
        why: Criterion,
        boundary: Criterion,
        completion: Criterion,
      }),
    )
    .max(12),
});
export type CallEvaluatorOutput = z.infer<typeof CallEvaluatorOutput>;
