import { getUserCard } from '@/server/admin/overview/cards';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Карточка учётной записи (имя и почта – маской). */
export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff(req, 'view_users');
  const { id } = await ctx.params;
  return Response.json(await getUserCard(id));
});
