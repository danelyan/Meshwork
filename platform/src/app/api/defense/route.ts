import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { startDefense } from '@/server/defense';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

const StartBody = z.object({ claimId: z.string().min(1).max(64) });

/** POST /api/defense {claimId} – начать (или продолжить активную) защиту утверждения. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const body = StartBody.parse(await req.json().catch(() => ({})));
  const result = await startDefense(candidateId, body.claimId, getLlm({ candidateId }));
  return Response.json(result, { status: result.resumed ? 200 : 201 });
});
