import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { confirmClaimsBatch } from '@/server/claims';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) });

/** POST /api/claims/confirm-batch `{ ids }` — «подтвердить все со слов»: одна транзакция, только свои self_reported. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await confirmClaimsBatch(candidateId, body.ids));
});
