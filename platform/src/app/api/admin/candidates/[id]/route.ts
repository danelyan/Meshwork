import { getCandidateCard } from '@/server/admin/overview/cards';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Карточка кандидата: категория, попытки теста, утверждения, согласия, приглашения, жалобы. ПДн — только через /pii. */
export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff(req, 'view_candidates');
  const { id } = await ctx.params;
  return Response.json(await getCandidateCard(id));
});
