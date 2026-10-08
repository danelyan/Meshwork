import { prisma } from '@/server/db';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** История разговора (только владелец; чужой → 404). Служебные строки (system, tool, пустые assistant с вызовами) не отдаются. */
export const GET = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const conv = await prisma.conversation.findFirst({
    where: { id, candidateId },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  if (!conv) throw errors.notFound('Разговор не найден');
  const rows = await prisma.message.findMany({
    where: { conversationId: conv.id, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  const messages = rows.filter((m) => m.role === 'user' || m.content.trim().length > 0);
  return Response.json({ conversation: conv, messages });
});
