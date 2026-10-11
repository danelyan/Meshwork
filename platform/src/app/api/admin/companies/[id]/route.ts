import { getCompanyCard } from '@/server/admin/overview/cards';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Карточка компании: профиль, ИНН, представители (маски), вакансии, приглашения, жалобы, индекс доверия, санкция. */
export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff(req, 'view_companies');
  const { id } = await ctx.params;
  return Response.json(await getCompanyCard(id));
});
