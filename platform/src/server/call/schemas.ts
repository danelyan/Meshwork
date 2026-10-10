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
    // Текст обязателен: распознаёт /audio (SpeechKit) или браузер. /turn сам STT не зовёт — иначе
    // при пустом тексте сегмент распознавался бы второй раз.
    text: z.string().max(MAX_UTTERANCE_CHARS),
    audioRef: z
      .string()
      .regex(/^\d{3}\.wav$/, 'audioRef — имя сегмента из /audio')
      .optional(),
  })
  .refine((b) => b.text.trim().length > 0, { message: 'Нужен текст ответа', path: ['text'] });
export type TurnBody = z.infer<typeof TurnBody>;

export const CallConsentBody = z.object({ version: z.string().min(1).max(64) });

/** Перебивание: индекс текущей реплики ИИ и сколько её предложений успело прозвучать (lib/sentences.ts). */
export const InterruptBody = z.object({
  index: z.number().int().min(0),
  heardSentences: z.number().int().min(0).max(64),
});
export type InterruptBody = z.infer<typeof InterruptBody>;

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
  // Без `.regex()`: pattern в JSON Schema провайдеры со строгим выводом (guided decoding) якорят на всю
  // строку, и `[а-яё]` даёт вопрос из одной буквы (живой прогон 10.10, deepseek через Yandex).
  // Кириллицу проверяет код (nextCallQuestion в interviewer.ts).
  question: z.string().min(10).max(600),
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
