import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { assertExpertEnabled, expertView, requireExpert } from '@/server/expert';
import { finishAttempt } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** POST /api/expert/attempt/[id]/finish – досрочный итог попытки эксперта с разбором (категория не пишется). */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  assertExpertEnabled();
  const candidateId = await requireExpert(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  return Response.json(await expertView(candidateId, await finishAttempt(candidateId, id)));
});
