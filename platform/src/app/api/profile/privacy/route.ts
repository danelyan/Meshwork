import { assertSameOrigin } from '@/server/auth/csrf';
import { getPrivacy, setPrivacy } from '@/server/employer';
import { PrivacyInput } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/profile/privacy – видят ли кандидата работодатели (R-C-13). */
export const GET = withErrors(async (req: Request) => Response.json(await getPrivacy(requireCandidate(req))));

/** POST `{ hiddenFromEmployers }`. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { hiddenFromEmployers } = PrivacyInput.parse(await req.json().catch(() => ({})));
  return Response.json(await setPrivacy(candidateId, hiddenFromEmployers));
});
