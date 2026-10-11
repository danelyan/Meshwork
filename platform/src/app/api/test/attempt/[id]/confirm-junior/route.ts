import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { confirmJunior } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** POST /api/test/attempt/[id]/confirm-junior – Middle не подтверждён, Junior по той же попытке – по согласию кандидата (R-C-08). */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  return Response.json(await confirmJunior(candidateId, id));
});
