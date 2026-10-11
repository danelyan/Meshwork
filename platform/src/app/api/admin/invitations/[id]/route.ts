import { getInvitationCard } from '@/server/admin/overview/cards';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Карточка приглашения (кандидат под псевдонимом). */
export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff(req, 'view_invitations');
  const { id } = await ctx.params;
  return Response.json(await getInvitationCard(id));
});
