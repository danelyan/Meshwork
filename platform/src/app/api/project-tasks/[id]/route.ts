import { withErrors } from '@/server/errors';
import { getTaskForCandidate } from '@/server/project/service';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/project-tasks/:id – задание кандидату: условие, контракт, видимые тесты, ссылка на заготовку, свои сдачи. */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const candidateId = requireCandidate(req);
  const { id } = await params;
  return Response.json(await getTaskForCandidate(candidateId, id));
});
