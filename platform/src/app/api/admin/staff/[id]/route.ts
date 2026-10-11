import { z } from 'zod';

import { STAFF_ROLES } from '@/server/admin/permissions';
import { requireStaff } from '@/server/admin/session';
import { updateStaff } from '@/server/admin/staff';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const StaffPatchBody = z.union([
  z.object({ role: z.enum(STAFF_ROLES), reason: z.string().max(1000) }),
  z.object({ disabled: z.boolean(), reason: z.string().max(1000) }),
  z.object({ resetTotp: z.literal(true), reason: z.string().max(1000) }),
]);

/**
 * Изменить сотрудника (только owner): сменить роль, отключить/включить или сбросить 2FA. Причина обязательна,
 * сессии сотрудника отзываются. Себя менять нельзя; последний активный owner не снимается (409).
 */
export const PATCH = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireStaff(req, 'manage_staff');
  const { id } = await ctx.params;
  const body = StaffPatchBody.parse(await req.json().catch(() => ({})));
  const { reason, ...patch } = body;
  return Response.json({ staff: await updateStaff(actor, id, patch, reason) });
});
