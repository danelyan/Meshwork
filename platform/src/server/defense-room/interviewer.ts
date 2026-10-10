import { z } from 'zod';

import { tag } from '../defense/prompt-utils';
import { responseJsonSchema } from '../llm/schema';
import type { LlmProvider } from '../llm/types';
import { loadRoomPrompt } from './prompts';
import type { PlanItem } from './types';

/**
 * Интервьюер защиты проекта: после ответа кандидата решает, нужно ли одно уточнение по текущему
 * вопросу (`LlmPurpose.call_interviewer`). Ничего не оценивает. Вопросы плана задаёт код по списку,
 * модель только уточняет. Модель недоступна или ответ невалиден → без уточнения, нейтральный переход
 * (так работает и stub-провайдер — детерминированно).
 */

export const MAX_FOLLOWUPS = 1;
const NEUTRAL_ACKS = ['Понял, спасибо.', 'Хорошо, идём дальше.', 'Принято.'];

export const InterviewerOutput = z.object({
  ack: z.string().max(80),
  followUp: z.string().max(400),
});
const JSON_SCHEMA = responseJsonSchema(InterviewerOutput) as object;

export interface InterviewStep {
  ack: string;
  followUp: string | null;
  fallback: boolean;
}

export function neutralAck(seq: number): string {
  return NEUTRAL_ACKS[seq % NEUTRAL_ACKS.length]!;
}

export async function decideFollowUp(item: PlanItem, answer: string, seq: number, llm: LlmProvider, signal?: AbortSignal): Promise<InterviewStep> {
  if (item.followUps >= MAX_FOLLOWUPS) return { ack: neutralAck(seq), followUp: null, fallback: false };
  const expected = item.source === 'qlc' ? item.expectedPoints : [];
  try {
    const res = await llm.complete(
      {
        purpose: 'call_interviewer',
        system: loadRoomPrompt('interviewer'),
        messages: [
          {
            role: 'user',
            content: [
              tag('current_question', item.question),
              tag('expected_points', expected.join('; ') || '(нет)'),
              tag('answer', answer.trim() || '(кандидат промолчал)'),
              tag('followups_used', String(item.followUps)),
              'Ответ — только JSON по схеме.',
            ].join('\n'),
          },
        ],
        schema: { name: 'defense_followup', jsonSchema: JSON_SCHEMA },
        temperature: 0.3,
        maxTokens: 300,
      },
      signal,
    );
    const parsed = InterviewerOutput.safeParse(res.kind === 'json' ? res.json : undefined);
    if (parsed.success) {
      const follow = parsed.data.followUp.trim();
      const ack = parsed.data.ack.trim();
      return {
        ack: /[а-яё]/i.test(ack) ? ack : neutralAck(seq),
        followUp: follow.length >= 10 && /[а-яё]/i.test(follow) ? follow : null,
        fallback: false,
      };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[defense-room] interviewer fallback:', err instanceof Error ? err.message : err);
  }
  return { ack: neutralAck(seq), followUp: null, fallback: true };
}
