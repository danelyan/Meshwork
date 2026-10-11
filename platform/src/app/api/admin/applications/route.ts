import { listApplications } from '@/server/admin/overview/lists';
import { ApplicationListQuery } from '@/server/admin/overview/queries';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Список самооткликов кандидатов на вакансии (право просмотра приглашений). */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_invitations');
  const q = ApplicationListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listApplications(q));
});
