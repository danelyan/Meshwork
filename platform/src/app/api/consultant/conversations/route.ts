import { prisma } from '@/server/db';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Разговоры кандидата, свежие первыми. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const conversations = await prisma.conversation.findMany({
    where: { candidateId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return Response.json({ conversations });
});
