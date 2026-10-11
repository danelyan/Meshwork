import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { listAttempts } from '@/server/test';

export const dynamic = 'force-dynamic';

/** GET /api/test/attempts – история попыток кандидата (R-C-07). */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  return Response.json({ attempts: await listAttempts(candidateId) });
});
