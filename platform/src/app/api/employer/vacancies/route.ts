import { assertSameOrigin } from '@/server/auth/csrf';
import { createVacancy, listVacancies, loadEmployerContext } from '@/server/employer';
import { VacancyInput } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/employer/vacancies – потребности своей компании (R-E-02). */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json({ company: { id: ctx.companyId, name: ctx.companyName }, vacancies: await listVacancies(ctx.companyId) });
});

/** POST /api/employer/vacancies – создать потребность. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const input = VacancyInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await createVacancy(ctx.companyId, input), { status: 201 });
});
