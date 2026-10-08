import { prisma } from '@/server/db';

import type { AgentEvent } from './types';

/** Элемент ленты в сериализуемом виде (совпадает с FeedItem компонента). */
export type RestoredItem =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'agent'; event: AgentEvent };

export interface RestoredChat {
  conversationId: string | null;
  items: RestoredItem[];
}

/**
 * Последний разговор кандидата для перезагрузки страницы: реплики (user и
 * непустые assistant) и карточки утверждений, которые ещё ждут ответа, с
 * актуальными статусами из БД. Чужие разговоры не читаются: выборка по candidateId.
 */
export async function loadLastChat(candidateId: string): Promise<RestoredChat> {
  const conv = await prisma.conversation.findFirst({ where: { candidateId }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  const items: RestoredItem[] = [];
  if (conv) {
    const rows = await prisma.message.findMany({
      where: { conversationId: conv.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true },
    });
    for (const m of rows) {
      if (m.role === 'user') items.push({ id: `r-${m.id}`, role: 'user', text: m.content });
      else if (m.content.trim()) items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'message', text: m.content } });
    }
  }
  const pending = await prisma.claim.findMany({ where: { candidateId, status: 'proposed' }, orderBy: { createdAt: 'asc' } });
  if (pending.length) {
    items.push({
      id: 'r-pending-claims',
      role: 'agent',
      event: {
        type: 'claims',
        rejected: 0,
        proposed: pending.map((c) => ({
          id: c.id,
          catalogId: c.catalogId,
          statement: c.statement,
          level: c.level,
          quote: c.quote,
          sourceRef: c.sourceRef,
          limits: c.limits,
          status: c.status,
        })),
      },
    });
  }
  return { conversationId: conv?.id ?? null, items };
}
