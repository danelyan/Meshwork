import { z } from 'zod';

import { prisma } from '@/server/db';
import { recommendTest } from '@/server/recommend';
import type { AgentTool } from '../types';
import { EmptyInput } from './shared';

/**
 * Экран теста на грейд. Тест делает отдельный лейн (E-02 «Что НЕ входит»):
 * пока маршрута нет — null, и модель честно говорит, что тест ещё не открыт.
 * Интегратор после слияния лейна test ставит сюда путь экрана.
 */
export const TEST_ROUTE: string | null = '/test';

const Spec = z.enum(['backend', 'frontend']);
const Grade = z.enum(['junior', 'middle']);
const Output = z.object({
  category: z.object({ specialization: Spec, grade: Grade, confirmedAt: z.string() }).nullable(),
  history: z.array(z.object({ specialization: Spec, grade: Grade, confirmedAt: z.string() })),
  recommended: z.object({ specialization: Spec, grade: Grade, reason: z.string(), allowed: z.boolean(), nextAllowedAt: z.string().optional() }),
  testAvailable: z.boolean(),
  testUrl: z.string().nullable(),
  note: z.string(),
});

export const getTestStatus: AgentTool<Record<string, never>, z.infer<typeof Output>> = {
  name: 'get_test_status',
  description:
    'Статус теста на категорию: текущая категория (только из теста; null — теста не было), история пересдач, какой тест рекомендован (специализация, грейд, причина, можно ли сменить грейд сейчас) и открыт ли экран теста. ' +
    'Вызывай, когда кандидат спрашивает про тест, категорию или грейд, или nextStep = test. Не вызывай вместе с recommend_test в одном ходе: здесь рекомендация уже есть. Категорию не присваивай и не обещай — её даёт только тест.',
  input: EmptyInput,
  output: Output,
  async handler(ctx) {
    const [rows, rec] = await Promise.all([
      prisma.candidateCategory.findMany({ where: { candidateId: ctx.candidateId }, orderBy: { confirmedAt: 'desc' }, take: 5 }),
      recommendTest(ctx.candidateId),
    ]);
    const history = rows.map((r) => ({ specialization: r.specialization, grade: r.grade, confirmedAt: r.confirmedAt.toISOString() }));
    ctx.emit({ type: 'recommendations', items: [{ kind: 'test', ...rec }] });
    return {
      category: history[0] ?? null,
      history,
      recommended: rec,
      testAvailable: TEST_ROUTE !== null,
      testUrl: TEST_ROUTE,
      note:
        TEST_ROUTE === null
          ? 'Экран теста ещё не открыт на платформе: скажи об этом честно и предложи пока подтвердить карточки и посмотреть вакансии.'
          : 'Тест выбирает кандидат; это рекомендация, не категория.',
    };
  },
};
