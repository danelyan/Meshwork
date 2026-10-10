import { z } from 'zod';

import { CALL_LIMITS } from '@/server/call/plan';
import { hasCallConsent } from '@/server/call/consent';
import { prisma } from '@/server/db';
import type { AgentTool } from '../types';

const Input = z.object({
  reason: z.string().min(3).max(300).describe('Зачем созвон именно сейчас, одной фразой для кандидата (например: «проверим глубину по базам данных из резюме»)'),
});
const Output = z.object({
  offered: z.boolean(),
  activeCallId: z.string().nullable(),
  consentNeeded: z.boolean(),
  questions: z.string(),
  note: z.string(),
});

/**
 * Предложить квалифицирующий созвон (ADR 0003, ступень 1). Только предложение: в ленте появляется
 * кнопка «Созвониться», звонок начинает сам кандидат кликом (и даёт согласие на запись). Инструмент
 * ничего не создаёт и не пишет.
 */
export const suggestCall: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'suggest_call',
  description:
    'Предложить кандидату короткий голосовой созвон с ИИ-интервьюером (4–6 вопросов по специализации и утверждениям профиля; отдельный оценщик строит карту глубины, подтверждённые темы получают уровень «проверено платформой»). ' +
    'Вызывай, когда у кандидата есть утверждения со слов или из артефактов и он хочет поднять доказанность или спрашивает, как показать глубину; не чаще раза за разговор. Ничего не запускает: в ленте появится кнопка, созвон начинает кандидат.',
  input: Input,
  output: Output,
  async handler(ctx, { reason }) {
    const [active, consent] = await Promise.all([
      prisma.callSession.findFirst({ where: { candidateId: ctx.candidateId, kind: 'qualifying', status: 'active' }, select: { id: true } }),
      hasCallConsent(ctx.candidateId),
    ]);
    ctx.emit({ type: 'call_offer', reason });
    return {
      offered: true,
      activeCallId: active?.id ?? null,
      consentNeeded: !consent,
      questions: `${CALL_LIMITS.minQuestions}–${CALL_LIMITS.maxQuestions}`,
      note:
        'Кнопка «Созвониться» показана в ленте и есть в поле ввода. Созвон записывается (транскрипт и аудио ответов) только с согласия кандидата; категорию он не меняет — её даёт тест.',
    };
  },
};
