import { withErrors } from '@/server/errors';
import { listFeed } from '@/server/project/service';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/project-tasks/feed — лента обезличенных проектных заданий направления и грейда кандидата
 * (ADR 0003, п. 6): без компании, потребности и зарплаты; с условием и видимыми тестами; лимит активных.
 */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  return Response.json(await listFeed(candidateId));
});
