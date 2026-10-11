import { assertSameOrigin } from '@/server/auth/csrf';
import { assertEmployerConsents } from '@/server/consent/service';
import { loadEmployerContext } from '@/server/employer';
import { ApplicationAnswer } from '@/server/employer/application-schemas';
import { respondApplication } from '@/server/employer/applications';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** PATCH /api/employer/applications/:id `{ action: accept | decline }` — ответ на отклик (R-C-12). Чужой — 404, повторный ответ — 409. */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId);
  const { id } = await params;
  const { action } = ApplicationAnswer.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await respondApplication(ctx.companyId, id, action));
});
