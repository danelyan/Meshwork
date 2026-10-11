import { z } from 'zod';

import { STAFF_ROLES } from '@/server/admin/permissions';
import { requireStaff } from '@/server/admin/session';
import { createStaff, listStaff } from '@/server/admin/staff';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const StaffInviteBody = z.object({ email: z.string().trim().min(3).max(254), name: z.string().trim().min(1).max(120), role: z.enum(STAFF_ROLES) });

/** Персонал платформы (только owner): список. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'manage_staff');
  return Response.json({ staff: await listStaff() });
});

/** Пригласить сотрудника (только owner): создаётся учётка с временным паролем — он в ответе один раз. TOTP — при первом входе. */
export const POST = withErrors(async (req: Request) => {
  const actor = await requireStaff(req, 'manage_staff');
  const body = StaffInviteBody.parse(await req.json().catch(() => ({})));
  const r = await createStaff(actor, body);
  return Response.json({ staff: r.staff, temporaryPassword: r.password }, { status: 201 });
});
