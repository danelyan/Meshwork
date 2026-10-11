import { prisma } from '@/server/db';

/**
 * Суточный бюджет токенов на кандидата: сумма input+output по AgentRun за
 * скользящие 24 часа (не календарный день – иначе в полночь МСК лимит
 * обнуляется «бесплатно»). 0 – лимит выключен.
 */
export class BudgetExceededError extends Error {
  constructor(
    readonly used: number,
    readonly budget: number,
  ) {
    super(`Суточный бюджет токенов исчерпан: ${used} из ${budget}`);
    this.name = 'BudgetExceededError';
  }
}

export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function tokensUsedLast24h(candidateId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - BUDGET_WINDOW_MS);
  const agg = await prisma.agentRun.aggregate({
    where: { candidateId, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
}

/** Бросает BudgetExceededError, если лимит уже выбран. */
export async function assertBudget(candidateId: string, budget: number, now: Date = new Date()): Promise<void> {
  if (budget <= 0) return;
  const used = await tokensUsedLast24h(candidateId, now);
  if (used >= budget) throw new BudgetExceededError(used, budget);
}
