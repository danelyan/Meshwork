import { z } from 'zod';

import { LEVEL_ORDER, levelRank, PLATFORM_UPGRADABLE } from '@/server/claims/levels';
import type { EvidenceLevel } from '@/server/claims/types';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import type { AgentTool } from '../types';

const Level = z.enum(['self_reported', 'artifact', 'platform', 'third_party']);
const Input = z.object({ claimId: z.string().min(1).max(64).describe('id утверждения из get_profile') });
const Way = z.object({
  toLevel: Level,
  kind: z.enum(['task', 'interview', 'link_account']),
  how: z.string(),
  taskId: z.string().optional(),
});
const Output = z.object({
  claimId: z.string(),
  statement: z.string(),
  level: Level,
  levelLabel: z.string(),
  why: z.string(),
  limits: z.string(),
  defense: z.object({ status: z.enum(['active', 'completed', 'abandoned']), completedAt: z.string().nullable() }).nullable(),
  ways: z.array(Way),
  note: z.string(),
});

export const LEVEL_LABEL: Record<EvidenceLevel, string> = {
  self_reported: 'со слов',
  artifact: 'есть ссылка на работу',
  platform: 'проверено платформой',
  third_party: 'подтверждено третьей стороной',
};

/** Почему уровень такой: по типу источника (ADR-0001), не по оценке модели. */
export function whyLevel(level: EvidenceLevel, sourceKind: string): string {
  switch (level) {
    case 'self_reported':
      return `Источник - ${sourceKind === 'chat' ? 'слова в чате' : 'резюме или документ'}: это рассказ кандидата, платформа его не проверяла.`;
    case 'artifact':
      return 'Источник - публичный артефакт (репозиторий, страница, профиль без подтверждённого владения): работа видна, но кто её сделал и понимает ли - не проверено.';
    case 'platform':
      return 'Платформа проверила сама: тест на грейд, созвон с ИИ или защита утверждения.';
    case 'third_party':
      return 'Подтверждено третьей стороной при подтверждённом владении аккаунтом (например, реестр ФСП).';
  }
}

/**
 * Как поднять уровень: только пути, которые реально есть у утверждения
 * (`suggestedProof` каталога: task:*, interview:defend, registry:*) и выше текущего, по возрастанию
 * уровня (LEVEL_ORDER). Тест и защита – только для PLATFORM_UPGRADABLE.
 * Уровень ставит код по результату проверки – инструмент ничего не меняет.
 */
export function waysUp(level: EvidenceLevel, proof: string[]): z.infer<typeof Way>[] {
  const rank = levelRank(level);
  const ways: z.infer<typeof Way>[] = [];
  if (rank < levelRank('artifact')) {
    ways.push({ toLevel: 'artifact', kind: 'link_account', how: 'Прислать ссылку на репозиторий или страницу, где эта работа видна.' });
  }
  if (rank < levelRank('third_party') && proof.some((p) => p.startsWith('registry:'))) {
    ways.push({ toLevel: 'third_party', kind: 'link_account', how: 'Привязать аккаунт ФСП: результат из реестра - подтверждение третьей стороной.' });
  }
  if (PLATFORM_UPGRADABLE.has(level)) {
    const task = proof.find((p) => p.startsWith('task:'));
    if (task) ways.push({ toLevel: 'platform', kind: 'task', how: 'Задание из банка платформы на эту тему - для практики. Решение платформа пока не принимает и не проверяет, поэтому уровень сейчас поднимает защита утверждения или созвон с ИИ.', taskId: task });
    if (proof.includes('interview:defend')) ways.push({ toLevel: 'platform', kind: 'interview', how: 'Пройти защиту утверждения: 3–5 вопросов в чате о том, как и почему это сделано.' });
  }
  return ways;
}

export const explainEvidence: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'explain_evidence',
  description:
    'Объяснить уровень доказанности одного утверждения: почему он такой (по типу источника), что утверждение не доказывает, идёт ли защита и какими путями поднять уровень (задание, защита, привязка аккаунта). ' +
    'Вызывай на «почему со слов?», «как подтвердить навык?», «что даст защита?». Уровень не меняет – его ставит код по результату проверки. Чтобы дать ссылку на выбранный путь – потом start_verification.',
  input: Input,
  output: Output,
  async handler(ctx, { claimId }) {
    const claim = await prisma.claim.findFirst({
      where: { id: claimId, candidateId: ctx.candidateId },
      select: {
        id: true,
        statement: true,
        level: true,
        sourceKind: true,
        limits: true,
        suggestedProof: true,
        status: true,
        defenseSessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, completedAt: true } },
      },
    });
    if (!claim) throw errors.notFound('Утверждение не найдено');
    const proof = Array.isArray(claim.suggestedProof) ? (claim.suggestedProof as unknown[]).map(String) : [];
    const d = claim.defenseSessions[0];
    const ways = claim.status === 'rejected' ? [] : waysUp(claim.level, proof);
    const top = LEVEL_ORDER[LEVEL_ORDER.length - 1];
    return {
      claimId: claim.id,
      statement: claim.statement,
      level: claim.level,
      levelLabel: LEVEL_LABEL[claim.level],
      why: whyLevel(claim.level, claim.sourceKind),
      limits: claim.limits,
      defense: d ? { status: d.status, completedAt: d.completedAt?.toISOString() ?? null } : null,
      ways,
      note:
        claim.status === 'rejected'
          ? 'Утверждение отклонено кандидатом - поднимать нечего.'
          : ways.length
            ? 'Уровень поднимает код по результату проверки, не ты и не кандидат.'
            : `Для этого утверждения на платформе нет пути выше уровня «${LEVEL_LABEL[claim.level]}»${claim.level === top ? '' : PLATFORM_UPGRADABLE.has(claim.level) ? ' (нет задания, защиты или реестра в каталоге)' : ' (выше платформы уровня нет)'}.`,
    };
  },
};
