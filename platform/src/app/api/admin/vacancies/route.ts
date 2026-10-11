import { listVacancies, VacancyListQuery } from '@/server/admin/overview/lists';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Список потребностей и вакансий. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_vacancies');
  const q = VacancyListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listVacancies(q));
});
