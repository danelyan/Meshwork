import { listCompanies } from '@/server/admin/overview/lists';
import { CompanyListQuery } from '@/server/admin/overview/queries';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Список компаний с индексом доверия и состоянием проверки и блокировки. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_companies');
  const q = CompanyListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listCompanies(q));
});
