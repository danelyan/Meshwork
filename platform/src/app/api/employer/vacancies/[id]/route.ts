import { assertSameOrigin } from '@/server/auth/csrf';
import { getVacancy, loadEmployerContext, setVacancyArchived, updateVacancy } from '@/server/employer';
import { VacancyInput, VacancyPatch } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/employer/vacancies/:id — своя потребность; чужая — 404. */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await getVacancy(ctx.companyId, id));
});

/** PUT — заменить поля потребности (форма редактирования). */
export const PUT = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const input = VacancyInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await updateVacancy(ctx.companyId, id, input));
});

/** PATCH `{ archived }` — закрыть / вернуть потребность. */
export const PATCH = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const { archived } = VacancyPatch.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await setVacancyArchived(ctx.companyId, id, archived));
});
