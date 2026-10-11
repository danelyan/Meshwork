import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import { getProfile } from '@/server/claims';
import type { AgentTool } from '../types';
import { EmptyInput, SourceKindSchema } from './shared';
import { GRADES } from '@/lib/grades';

const Output = z.object({
  candidate: z.object({
    id: z.string(),
    name: z.string(),
    specialization: z.enum(SPECIALIZATIONS).nullable(),
    fspState: z.enum(['not_linked', 'no_achievements', 'unavailable', 'linked']),
  }),
  category: z.object({ specialization: z.enum(SPECIALIZATIONS), grade: z.enum(GRADES), confirmedAt: z.string() }).nullable(),
  claims: z.array(
    z.object({
      id: z.string(),
      catalogId: z.string(),
      statement: z.string(),
      /** Как карточка показана кандидату (под цитату); null – старая запись. Говорить с кандидатом – этими словами. */
      wording: z.string().nullable(),
      level: z.enum(['self_reported', 'artifact', 'platform', 'third_party']),
      sourceKind: SourceKindSchema,
      status: z.enum(['proposed', 'confirmed', 'edited', 'rejected']),
      limits: z.string(),
      suggestedProof: z.array(z.string()),
    }),
  ),
  summary: z.object({ confirmed: z.number().int(), proposed: z.number().int(), rejected: z.number().int() }),
});

/** Состояние профиля – каждый ход отсюда, не из истории чата . */
export const getProfileTool: AgentTool<Record<string, never>, z.infer<typeof Output>> = {
  name: 'get_profile',
  description:
    'Текущий профиль кандидата: категория (только из теста; null – теста не было), утверждения со статусом (proposed – ждёт ответа, confirmed/edited – в профиле, rejected – отклонено) и уровнем доказанности. Вызывай в начале хода, где нужен профиль (рекомендации, PDF, вопросы о навыках): кандидат мог подтвердить или отклонить карточки между ходами. Отклонённые кандидатом – не предлагать снова.',
  input: EmptyInput,
  output: Output,
  async handler(ctx) {
    const p = await getProfile(ctx.candidateId);
    const claims = p.claims.map((c) => ({
      id: c.id,
      catalogId: c.catalogId,
      statement: c.statement,
      wording: c.wording ?? null,
      level: c.level,
      sourceKind: c.sourceKind,
      status: c.status,
      limits: c.limits,
      suggestedProof: c.suggestedProof,
    }));
    const count = (s: string) => claims.filter((c) => c.status === s).length;
    return {
      candidate: p.candidate,
      category: p.category,
      claims,
      summary: { confirmed: count('confirmed') + count('edited'), proposed: count('proposed'), rejected: count('rejected') },
    };
  },
};
