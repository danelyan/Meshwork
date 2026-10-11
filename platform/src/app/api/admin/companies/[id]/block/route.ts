import { z } from 'zod';

import { blockCompany, unblockCompany } from '@/server/admin/accounts/service';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const BlockBody = z.object({ reason: z.string().max(1000), until: z.iso.datetime({ offset: true }).nullish() });
const UnblockBody = z.object({ reason: z.string().max(1000) });
type Ctx = { params: Promise<{ id: string }> };

/** Заблокировать компанию (owner, moderator): приглашения не отправляются, вакансии скрыты от кандидатов. */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const staff = await requireStaff(req, 'block_company');
  const { id } = await ctx.params;
  const body = BlockBody.parse(await req.json().catch(() => ({})));
  return Response.json({ block: await blockCompany(staff, id, body) });
});

/** Снять блокировку компании (owner, moderator). */
export const DELETE = withErrors(async (req: Request, ctx: Ctx) => {
  const staff = await requireStaff(req, 'block_company');
  const { id } = await ctx.params;
  const body = UnblockBody.parse(await req.json().catch(() => ({})));
  return Response.json({ block: await unblockCompany(staff, id, body) });
});
