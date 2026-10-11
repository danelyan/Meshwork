import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { getAttempt } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** GET /api/test/attempt/[id] – состояние попытки: текущее задание (без ключа) или итог. Чужая – 404. */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  return Response.json(await getAttempt(candidateId, id));
});
