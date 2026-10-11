import { z } from 'zod';

import { cooldownState, resetCooldown } from '@/server/admin/accounts/service';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const ResetBody = z.object({ reason: z.string().max(1000) });
type Ctx = { params: Promise<{ id: string }> };

/** Кулдауны теста кандидата: текущая категория, последняя попытка, последний сброс (owner, support). */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  await requireStaff(req, 'reset_cooldown');
  const { id } = await ctx.params;
  return Response.json(await cooldownState(id));
});

/** Сбросить кулдаун смены грейда и пересдачи (R-C-09) с причиной. Категорию не меняет (R-C-06). */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const staff = await requireStaff(req, 'reset_cooldown');
  const { id } = await ctx.params;
  const body = ResetBody.parse(await req.json().catch(() => ({})));
  return Response.json(await resetCooldown(staff, id, body));
});
