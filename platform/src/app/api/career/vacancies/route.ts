import { z } from 'zod';

import { withErrors } from '@/server/errors';
import { listFavorites } from '@/server/favorites';
import { careerVacancies } from '@/server/recommend/career';
import { requireCandidate, requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';
const Query = z.object({ saved: z.enum(['true', 'false']).optional() }).strict();

/** Active vacancy catalogue and genuine skill coverage; saved mode is scoped to the authenticated user. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const user = requireUser(req);
  const query = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const favorites = query.saved === 'true' ? await listFavorites(user) : null;
  return Response.json(await careerVacancies(candidateId, favorites?.ids));
});
