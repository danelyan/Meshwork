import { listInvitations, InvitationListQuery } from '@/server/admin/overview/lists';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Список приглашений: кандидат под псевдонимом. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_invitations');
  const q = InvitationListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listInvitations(q));
});
