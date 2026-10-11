import { listCandidateApplications } from '@/server/employer/applications';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/career/applications – мои отклики и их статусы (только свои, R-C-12, R-C-16). */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  return Response.json({ applications: await listCandidateApplications(candidateId) });
});
