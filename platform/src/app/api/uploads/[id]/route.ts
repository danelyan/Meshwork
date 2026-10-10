import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { deleteUpload } from '@/server/uploads/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Удалить загруженный файл: оригинал с диска и запись. Неподтверждённые утверждения из файла
 * удаляются, подтверждённые и исправленные человеком остаются. Чужое и несуществующее → 404.
 */
export const DELETE = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  if (!id || id.length > 64) throw errors.notFound('Файл не найден');
  return Response.json(await deleteUpload(candidateId, id));
});
