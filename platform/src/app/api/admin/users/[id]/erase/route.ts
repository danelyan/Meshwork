import { z } from 'zod';

import { eraseAccountByStaff } from '@/server/admin/accounts/service';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const EraseBody = z.object({ confirm: z.string().max(64), reason: z.string().max(1000) });

/**
 * Удалить аккаунт по запросу субъекта ПДн (owner, support) через `eraseOwnAccount`. `confirm` — id пользователя,
 * введённый вручную (второе подтверждение). В журнал — id и факт удаления, без ПДн.
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'erase_account');
  const { id } = await ctx.params;
  const body = EraseBody.parse(await req.json().catch(() => ({})));
  return Response.json(await eraseAccountByStaff(staff, id, body));
});
