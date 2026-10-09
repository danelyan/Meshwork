import { z } from 'zod';

import type { AgentTool } from '../types';

const Input = z.object({
  question: z.string().min(3).max(500).describe('Один короткий вопрос кандидату'),
  options: z.array(z.string().min(1).max(80)).min(2).max(4).optional().describe('2–4 варианта ответа кнопками'),
});
const Output = z.object({ asked: z.literal(true) });

/** Уточняющий вопрос с вариантами; ход на этом заканчивается — ответ придёт следующим сообщением кандидата. */
export const askUser: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'ask_user',
  description:
    'Задать кандидату один уточняющий вопрос с 2–4 вариантами кнопками, когда следующий шаг зависит от его выбора (специализация, цель, грейд теста, привязывать ли ФСП, какое утверждение защищать). Не вызывай, если ответ уже есть в анкете или истории. После вызова ход заканчивается: ответ придёт следующим сообщением, текст после вызова не пиши.',
  input: Input,
  output: Output,
  terminal: true,
  async handler(ctx, { question, options }) {
    ctx.emit(options ? { type: 'ask', question, options } : { type: 'ask', question });
    return { asked: true as const };
  },
};
