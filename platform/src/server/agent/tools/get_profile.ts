import { z } from 'zod';

import { getProfile } from '@/server/claims';
import type { AgentTool } from '../types';
import { EmptyInput, SourceKindSchema } from './shared';

const Output = z.object({
  candidate: z.object({
    id: z.string(),
    name: z.string(),
    specialization: z.enum(['backend', 'frontend']).nullable(),
    fspState: z.enum(['not_linked', 'no_achievements', 'unavailable', 'linked']),
  }),
  category: z.object({ specialization: z.enum(['backend', 'frontend']), grade: z.enum(['junior', 'middle']), confirmedAt: z.string() }).nullable(),
  claims: z.array(
    z.object({
      id: z.string(),
      catalogId: z.string(),
      statement: z.string(),
      level: z.enum(['self_reported', 'artifact', 'platform', 'third_party']),
      sourceKind: SourceKindSchema,
      status: z.enum(['proposed', 'confirmed', 'edited', 'rejected']),
      limits: z.string(),
      suggestedProof: z.array(z.string()),
    }),
  ),
  summary: z.object({ confirmed: z.number().int(), proposed: z.number().int(), rejected: z.number().int() }),
});

/** Состояние профиля — каждый ход отсюда, не из истории чата (ТЗ § 4.1, research/10 § 4.7). */
export const getProfileTool: AgentTool<Record<string, never>, z.infer<typeof Output>> = {
  name: 'get_profile',
  description:
    'Текущий профиль кандидата: категория (только из теста; null — теста не было), утверждения со статусом и уровнем. Отклонённые кандидатом — не предлагать снова.',
  input: EmptyInput,
  output: Output,
  async handler(ctx) {
    const p = await getProfile(ctx.candidateId);
    const claims = p.claims.map((c) => ({
      id: c.id,
      catalogId: c.catalogId,
      statement: c.statement,
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
