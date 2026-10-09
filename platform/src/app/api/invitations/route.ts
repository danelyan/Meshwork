import { listCandidateInvitations } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/invitations — входящие приглашения кандидата (только свои, R-C-16). `?view=1` отмечает просмотр. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const markViewed = new URL(req.url).searchParams.get('view') === '1';
  return Response.json({ invitations: await listCandidateInvitations(candidateId, markViewed) });
});
