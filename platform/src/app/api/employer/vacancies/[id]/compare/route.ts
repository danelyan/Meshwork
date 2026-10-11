import { compareForVacancy, loadEmployerContext } from '@/server/employer';
import { assertEmployerConsents } from '@/server/consent/service';
import { errors, withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employer/vacancies/:id/compare?a=<candidateId>&b=<candidateId>
 * «Почему A выше B»: разница итогового балла по факторам формулы ранжирования (employer/compare.ts).
 */
export const GET = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId);
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const a = q.get('a');
  const b = q.get('b');
  if (!a || !b) throw errors.badRequest('Нужны два кандидата: a и b');
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await compareForVacancy(ctx.companyId, id, a, b));
});
