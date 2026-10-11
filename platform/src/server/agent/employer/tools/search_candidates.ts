import { z } from 'zod';

import { searchBank } from '@/server/employer';
import type { MatchFilters } from '@/server/employer/ranking';
import { normalizeStack } from '@/server/employer/ranking';

import { CandidatesBlockSchema, toCandidatesBlock } from '../cards';

import { AGENT_RESULT_LIMIT, GradeSchema, SpecSchema, type EmployerTool } from './shared';

const Input = z.object({
  specialization: SpecSchema.optional().describe('backend, frontend, ai или engineering'),
  grade: GradeSchema.optional().describe('junior, middle или senior'),
  stack: z.array(z.string().min(1).max(40)).max(10).optional().describe('Метки стека: Go, Kafka, React…'),
  fsp: z.boolean().optional().describe('Только с подтверждёнными достижениями ФСП'),
  expandPool: z.boolean().optional().describe('Расширить пул: включить кандидатов без категории из теста (по умолчанию только с категорией)'),
  limit: z.number().int().min(1).max(AGENT_RESULT_LIMIT).default(5),
});
const Output = CandidatesBlockSchema;

/** Поиск по всей базе (R-E-04) тем же ранжированием, что кабинет; карточки — в ленту. */
export const searchCandidates: EmployerTool = {
  name: 'search_candidates',
  description:
    'Поиск по всей базе кандидатов без потребности: фильтры специализация, грейд, стек, ФСП; по умолчанию только кандидаты с категорией из теста, expandPool добавляет кандидатов без категории (помечены в summary). Возвращает публичные карточки (псевдоним, категория, покрытие, уровни доказанности) и показывает их работодателю в ленте. Имён и контактов в выдаче нет.',
  input: Input,
  output: Output,
  async handler(ctx, input: z.infer<typeof Input>) {
    const filters: MatchFilters = {};
    if (input.specialization) filters.specialization = input.specialization;
    if (input.grade) filters.grade = input.grade;
    const stack = normalizeStack(input.stack ?? []);
    if (stack.length) filters.stack = stack;
    if (input.fsp) filters.fsp = true;
    if (input.expandPool) filters.expandPool = true;
    const block = toCandidatesBlock(await searchBank(ctx.companyId, filters, input.limit));
    ctx.emit({ type: 'candidates', block });
    return block;
  },
};
