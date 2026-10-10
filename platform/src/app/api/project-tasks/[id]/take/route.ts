import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { takeTask } from '@/server/project/service';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/project-tasks/:id/take — взять задание (идемпотентно); не больше PROJECT_MAX_ACTIVE несданных — иначе 429. */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  return Response.json(await takeTask(candidateId, id));
});
