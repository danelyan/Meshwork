import { z } from 'zod';

import type { EmployerTool } from './shared';

const Input = z.object({
  question: z.string().min(3).max(500).describe('Один короткий вопрос работодателю'),
  options: z.array(z.string().min(1).max(80)).min(2).max(4).optional().describe('2–4 варианта ответа кнопками'),
});
const Output = z.object({ asked: z.literal(true) });

/** Уточняющий вопрос с вариантами (как у консультанта); ход на этом заканчивается. */
export const askEmployer: EmployerTool = {
  name: 'ask_user',
  description:
    'Задать работодателю один уточняющий вопрос с 2–4 вариантами кнопками, когда следующий шаг зависит от его выбора (какая потребность, искать ли по всей базе, специализация новой потребности). После вызова ход заканчивается — текст после вызова не пиши.',
  input: Input,
  output: Output,
  terminal: true,
  async handler(ctx, { question, options }: z.infer<typeof Input>) {
    ctx.emit(options ? { type: 'ask', question, options } : { type: 'ask', question });
    return { asked: true as const };
  },
};
