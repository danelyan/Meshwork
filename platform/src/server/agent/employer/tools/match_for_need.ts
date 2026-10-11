import { z } from 'zod';

import { matchForVacancy } from '@/server/employer';
import type { MatchFilters } from '@/server/employer/ranking';

import { CandidatesBlockSchema, toCandidatesBlock } from '../cards';

import { AGENT_RESULT_LIMIT, resolveVacancy, type EmployerTool } from './shared';

const Input = z.object({
  vacancyId: z.string().min(1).max(64).optional().describe('id потребности из get_employer_context; не указан — единственная активная'),
  limit: z.number().int().min(1).max(AGENT_RESULT_LIMIT).default(5),
  fsp: z.boolean().optional(),
  includeUntested: z.boolean().optional().describe('Включить и кандидатов без теста; по умолчанию только с категорией'),
});
const Output = CandidatesBlockSchema;

/** Подборка под потребность (R-E-03) — matching.ts; объяснение покрытия — из ranking.ts как есть. */
export const matchForNeed: EmployerTool = {
  name: 'match_for_need',
  description:
    'Подборка кандидатов под потребность работодателя: ранжирование по покрытию требований с учётом уровня доказанности, категории из теста и ФСП. Для каждого — сколько требований закрыто, чем доказано, чего не хватает. Карточки с кнопкой «Пригласить» показываются работодателю в ленте.',
  input: Input,
  output: Output,
  async handler(ctx, input: z.infer<typeof Input>) {
    const vacancy = await resolveVacancy(ctx.companyId, input.vacancyId);
    const filters: MatchFilters = {};
    if (input.fsp) filters.fsp = true;
    if (input.includeUntested) filters.includeUntested = true;
    const block = toCandidatesBlock(await matchForVacancy(ctx.companyId, vacancy.id, filters, input.limit));
    ctx.emit({ type: 'candidates', block });
    return block;
  },
};
