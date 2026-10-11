import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { deleteSource } from '@/server/uploads/service';

export const dynamic = 'force-dynamic';

/**
 * Удалить подключённую ссылку (url, GitHub, Codeforces, Stack Overflow) вместе со снимком.
 * Неподтверждённые утверждения из неё удаляются, подтверждённые и исправленные человеком остаются.
 * Чужое и несуществующее → 404.
 */
export const DELETE = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  if (!id || id.length > 64) throw errors.notFound('Ссылка не найдена');
  return Response.json(await deleteSource(candidateId, id));
});
