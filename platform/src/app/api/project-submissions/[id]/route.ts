import { withErrors } from '@/server/errors';
import { getSubmissionForCandidate } from '@/server/project/service';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/project-submissions/:id – статус и результат своей сдачи: балл скрытых тестов, видимые тесты, рубрика (без имён скрытых тестов). */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const candidateId = requireCandidate(req);
  const { id } = await params;
  return Response.json(await getSubmissionForCandidate(candidateId, id));
});
