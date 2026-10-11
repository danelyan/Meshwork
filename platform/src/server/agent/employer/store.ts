import { prisma, type Prisma } from '@/server/db';
import type { ChatMessage } from '@/server/llm/types';

import { BUDGET_WINDOW_MS, BudgetExceededError } from '../budget';

import { EMPLOYER_PROMPT_VERSION } from './prompt';

/** Сообщение разговора помощника работодателя (таблица EmployerMessage, не Message кандидата). */
export async function saveEmployerMessage(conversationId: string, m: ChatMessage): Promise<void> {
  await prisma.employerMessage.create({
    data: {
      conversationId,
      role: m.role,
      content: m.content,
      ...(m.toolCalls?.length ? { toolCalls: m.toolCalls as unknown as Prisma.InputJsonValue } : {}),
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    },
  });
  await prisma.employerConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

/** Версия промпта – системной строкой в разговоре (как у консультанта). */
export async function ensureEmployerPromptVersion(conversationId: string): Promise<void> {
  const marker = `prompt:${EMPLOYER_PROMPT_VERSION}`;
  const last = await prisma.employerMessage.findFirst({
    where: { conversationId, role: 'system' },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });
  if (last?.content === marker) return;
  await prisma.employerMessage.create({ data: { conversationId, role: 'system', content: marker } });
}

/**
 * Суточный бюджет токенов работодателя: AgentRun его разговоров за скользящие 24 часа.
 * У AgentRun нет ссылки на работодателя – связь через conversationId (id разговоров
 * EmployerConversation и Conversation – разные cuid, не пересекаются).
 */
export async function employerTokensUsedLast24h(employerProfileId: string, now: Date = new Date()): Promise<number> {
  const convs = await prisma.employerConversation.findMany({ where: { employerProfileId }, select: { id: true } });
  if (!convs.length) return 0;
  const agg = await prisma.agentRun.aggregate({
    where: { conversationId: { in: convs.map((c) => c.id) }, createdAt: { gte: new Date(now.getTime() - BUDGET_WINDOW_MS) } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
}

export async function assertEmployerBudget(employerProfileId: string, budget: number, now: Date = new Date()): Promise<void> {
  if (budget <= 0) return;
  const used = await employerTokensUsedLast24h(employerProfileId, now);
  if (used >= budget) throw new BudgetExceededError(used, budget);
}
