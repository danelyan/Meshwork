import { z } from 'zod';

import { blockUser, unblockUser } from '@/server/admin/accounts/service';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const BlockBody = z.object({ reason: z.string().max(1000), until: z.iso.datetime({ offset: true }).nullish() });
const UnblockBody = z.object({ reason: z.string().max(1000) });
type Ctx = { params: Promise<{ id: string }> };

/** Заблокировать пользователя (owner): вход закрыт, активные сессии отклоняются. Причина обязательна, `until` — срок. */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const staff = await requireStaff(req, 'block_user');
  const { id } = await ctx.params;
  const body = BlockBody.parse(await req.json().catch(() => ({})));
  return Response.json({ block: await blockUser(staff, id, body) });
});

/** Снять блокировку (owner, support). Сессии, выданные до блокировки, не оживают — нужен новый вход. */
export const DELETE = withErrors(async (req: Request, ctx: Ctx) => {
  const staff = await requireStaff(req, 'unblock_user');
  const { id } = await ctx.params;
  const body = UnblockBody.parse(await req.json().catch(() => ({})));
  return Response.json({ block: await unblockUser(staff, id, body) });
});
