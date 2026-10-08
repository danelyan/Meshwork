import { getProfile } from '@/server/claims';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Профиль текущего кандидата: категория (только из теста) и утверждения по уровням с датой и источником. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  return Response.json(await getProfile(candidateId));
});
