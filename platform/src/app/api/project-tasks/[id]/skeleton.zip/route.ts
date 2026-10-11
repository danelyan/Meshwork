import { withErrors } from '@/server/errors';
import { skeletonZip } from '@/server/project/service';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/project-tasks/:id/skeleton.zip – заготовка репозитория: starter, contract.md, видимые тесты, TASK.md (без скрытых тестов). */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const { filename, data } = await skeletonZip(candidateId, id);
  return new Response(new Uint8Array(data), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' },
  });
});
