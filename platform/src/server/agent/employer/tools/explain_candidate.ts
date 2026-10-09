import { z } from 'zod';

import { matchForVacancy, searchBank } from '@/server/employer';
import { pseudonym } from '@/server/employer/privacy';

import { AssistantCandidateSchema, toAssistantCandidate } from '../cards';

import { resolveVacancy, type EmployerTool } from './shared';

/** Сколько кандидатов просматриваем, чтобы найти позицию (весь пул демо-стенда — десятки). */
const EXPLAIN_SCAN = 1_000;

const Input = z.object({
  candidateId: z.string().min(1).max(64).describe('candidateId из карточки подборки'),
  vacancyId: z.string().min(1).max(64).optional().describe('Потребность; не указана — единственная активная, иначе поиск по базе'),
});
const Output = z.discriminatedUnion('inSelection', [
  z
    .object({
      inSelection: z.literal(true),
      target: z.string(),
      total: z.number().int(),
      candidate: AssistantCandidateSchema,
      /** Из чего сложился балл (ranking.ts, веса — weights.ts). */
      breakdown: z.object({ coverage: z.number(), category: z.number(), fsp: z.number(), stack: z.number(), specPenalty: z.number() }),
      provenCount: z.number().int(),
      leader: z.object({ alias: z.string(), score: z.number(), covered: z.number().int(), total: z.number().int() }).nullable(),
    })
    .strict(),
  z.object({ inSelection: z.literal(false), alias: z.string(), target: z.string(), reason: z.string() }).strict(),
]);

/**
 * Почему кандидат в подборке и почему на этом месте: покрытие требований, уровни
 * доказательств, прибавки за категорию, ФСП и стек. Ничего не пересчитывает —
 * читает RankedCandidate из той же выдачи, что кабинет.
 */
export const explainCandidate: EmployerTool = {
  name: 'explain_candidate',
  description:
    'Объяснить, почему кандидат в подборке и почему на этом месте (или почему его нет): какие требования закрыты и каким уровнем доказанности, чего не хватает, из чего сложился балл (покрытие, категория, ФСП, стек), чем отличается от первого места. Только по публичной карточке.',
  input: Input,
  output: Output,
  async handler(ctx, input: z.infer<typeof Input>) {
    let result;
    let target: string;
    let vacancy = null;
    try {
      vacancy = await resolveVacancy(ctx.companyId, input.vacancyId);
    } catch (err) {
      if (input.vacancyId) throw err;
    }
    if (vacancy) {
      result = await matchForVacancy(ctx.companyId, vacancy.id, {}, EXPLAIN_SCAN);
      target = `потребность «${vacancy.title}»`;
    } else {
      result = await searchBank(ctx.companyId, {}, EXPLAIN_SCAN);
      target = 'поиск по всей базе';
    }
    const item = result.items.find((i) => i.candidateId === input.candidateId);
    if (!item) {
      // Скрытый настройкой приватности и несуществующий неотличимы: о скрытых ничего не сообщаем.
      return {
        inSelection: false as const,
        alias: pseudonym(input.candidateId),
        target,
        reason: 'Кандидата нет в выдаче: он не закрывает ни одного требования, у него другая специализация или он недоступен работодателям.',
      };
    }
    const leader = result.items[0];
    return {
      inSelection: true as const,
      target,
      total: result.total,
      candidate: toAssistantCandidate(item),
      breakdown: { coverage: item.coverageScore, ...item.boosts },
      provenCount: item.provenCount,
      leader:
        leader && leader.candidateId !== item.candidateId
          ? { alias: pseudonym(leader.candidateId), score: leader.score, covered: leader.covered, total: leader.total }
          : null,
    };
  },
};
