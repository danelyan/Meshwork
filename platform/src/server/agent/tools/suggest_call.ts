import { z } from 'zod';

import { CALL_LIMITS } from '@/server/call/plan';
import { hasCallConsent } from '@/server/call/consent';
import { prisma } from '@/server/db';
import { resolveCallKind } from '@/server/interview/context';
import { INTERVIEW_LIMITS } from '@/server/interview/plan';
import type { AgentTool } from '../types';

const Input = z.object({
  reason: z.string().min(3).max(300).describe('Зачем созвон именно сейчас, одной фразой для кандидата (например: «проверим глубину по базам данных из резюме»)'),
});
const Output = z.object({
  offered: z.boolean(),
  activeCallId: z.string().nullable(),
  consentNeeded: z.boolean(),
  kind: z.enum(['qualifying', 'interview']),
  questions: z.string(),
  note: z.string(),
});

/**
 * Предложить созвон в сцене консультанта. Вид выбирает платформа (resolveCallKind): до теста –
 * квалифицирующий (ADR 0003, ступень 1), после – ИИнтервью (docs/competency-model.md). Только предложение:
 * в ленте появляется кнопка, звонок начинает сам кандидат кликом (и даёт согласие на запись).
 * Инструмент ничего не создаёт и не пишет.
 */
export const suggestCall: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'suggest_call',
  description:
    'Предложить кандидату голосовой созвон со мной в этой же сцене. Вид выбирает платформа и возвращает в kind: до теста на грейд – короткий созвон (4–6 вопросов по темам резюме, итог – карта глубины), после теста – созвон с ИИ по компетенциям (5–7 вопросов в четырёх блоках, итог – оценки по осям); в обоих подтверждённое поднимается до «проверено платформой». ' +
    'Вызывай, когда кандидат хочет поднять доказанность или показать глубину, и после теста как следующий шаг – созвон с ИИ; не чаще раза за разговор. Ничего не запускает: в ленте появится кнопка, созвон начинает кандидат.',
  input: Input,
  output: Output,
  async handler(ctx, { reason }) {
    const kind = await resolveCallKind(ctx.candidateId);
    const [active, consent] = await Promise.all([
      prisma.callSession.findFirst({ where: { candidateId: ctx.candidateId, kind, status: 'active' }, select: { id: true } }),
      hasCallConsent(ctx.candidateId),
    ]);
    ctx.emit({ type: 'call_offer', reason });
    return {
      offered: true,
      activeCallId: active?.id ?? null,
      consentNeeded: !consent,
      kind,
      questions: kind === 'interview' ? `${INTERVIEW_LIMITS.minQuestions}–${INTERVIEW_LIMITS.maxQuestions}` : `${CALL_LIMITS.minQuestions}–${CALL_LIMITS.maxQuestions}`,
      note:
        (kind === 'interview'
          ? 'Это созвон с ИИ после теста: четыре блока, около 20 минут, итог – оценки по осям. '
          : 'Это созвон с ИИ по темам резюме, итог – карта глубины. ') +
        'Кнопка показана в ленте и есть в поле ввода. Созвон записывается (транскрипт и аудио ответов) только с согласия кандидата; категорию он не меняет – её даёт тест.',
    };
  },
};
