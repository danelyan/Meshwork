import { errors, withErrors } from '@/server/errors';
import { assertExpertEnabled, expertView, requireExpert } from '@/server/expert';
import { getAttempt } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** GET /api/expert/attempt/[id] – попытка эксперта (только своя, по куке fsp_expert); после итога – разбор. */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  assertExpertEnabled();
  const candidateId = await requireExpert(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  return Response.json(await expertView(candidateId, await getAttempt(candidateId, id)));
});
