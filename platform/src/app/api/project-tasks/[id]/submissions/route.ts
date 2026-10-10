import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { SubmissionInput } from '@/server/project/schemas';
import { submitProject } from '@/server/project/service';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ repoUrl, aiLogText, commitSha? }` — сдать проект: публичный репозиторий GitHub (без commitSha — HEAD ветки по
 * умолчанию), журнал работы с ИИ. Проверка идёт в фоне: submitted → running → checked | failed (GET /api/project-submissions/:id).
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const input = SubmissionInput.parse(await req.json().catch(() => ({})));
  return Response.json(await submitProject(candidateId, id, input), { status: 202 });
});
