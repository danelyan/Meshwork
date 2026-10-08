import { z } from 'zod';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import type { AgentTool } from '../types';

const Input = z.object({
  claimId: z.string().min(1).max(64).describe('id утверждения из get_profile'),
  kind: z.enum(['task', 'interview', 'link_account']).describe('task — задание из банка; interview — защита утверждения в чате; link_account — привязать GitHub / Codeforces / ФСП'),
});
const Output = z.object({
  claimId: z.string(),
  kind: z.enum(['task', 'interview', 'link_account']),
  url: z.string(),
  statement: z.string(),
  currentLevel: z.string(),
  note: z.string(),
});

/**
 * Предложение способа доказать утверждение: ссылка, по которой кандидат сам
 * начинает задание / защиту / привязку. Сессий и проверок инструмент не
 * создаёт — это делает клик кандидата (ТЗ § 2: «предложение»).
 */
export const startVerification: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'start_verification',
  description:
    'Дать кандидату ссылку, чтобы поднять уровень утверждения: задание из банка, защита утверждения (короткое интервью в чате) или привязка аккаунта. Ничего не запускает само — кандидат переходит по ссылке.',
  input: Input,
  output: Output,
  async handler(ctx, { claimId, kind }) {
    const claim = await prisma.claim.findFirst({
      where: { id: claimId, candidateId: ctx.candidateId },
      select: { id: true, statement: true, level: true, status: true, suggestedProof: true },
    });
    if (!claim) throw errors.notFound('Утверждение не найдено');
    if (claim.status === 'rejected') throw errors.conflict('Утверждение отклонено кандидатом — проверять нечего');
    const proof = Array.isArray(claim.suggestedProof) ? (claim.suggestedProof as unknown[]).map(String) : [];
    const taskId = proof.find((p) => p.startsWith('task:'))?.slice('task:'.length);
    // Ссылки — только на существующие экраны UI. Отдельного экрана задания и
    // привязки аккаунта нет: задания — список в профиле, привязка — ссылкой в чат.
    const url =
      kind === 'interview'
        ? `/defense/${claim.id}`
        : kind === 'task'
          ? `/profile?claim=${claim.id}${taskId ? `&task=${encodeURIComponent(taskId)}` : ''}#tasks`
          : `/consultant?claim=${claim.id}`;
    const note =
      kind === 'interview'
        ? 'Защита проверяет понимание сейчас, не подлинность истории; уровень поднимает код по вердикту оценщика.'
        : kind === 'task'
          ? 'Задание из банка платформы — в списке заданий профиля; уровень ставит код по результату проверки.'
          : 'Пришли ссылку на профиль (GitHub, Codeforces, ФСП) в чат. Уровень «артефакт» или «третья сторона» — только после проверки владения.';
    return { claimId: claim.id, kind, url, statement: claim.statement, currentLevel: claim.level, note };
  },
};
