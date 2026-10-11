import { z } from 'zod';

import { requireStaff } from '@/server/admin/session';
import { changeOwnPassword } from '@/server/admin/staff';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const AdminPasswordBody = z.object({ current: z.string().min(1).max(256), next: z.string().min(8).max(128) });

/** Смена своего пароля (временный пароль из приглашения меняют после первого входа). Прочие сессии отзываются. */
export const POST = withErrors(async (req: Request) => {
  const staff = await requireStaff(req);
  const body = AdminPasswordBody.parse(await req.json().catch(() => ({})));
  await changeOwnPassword(staff, body.current, body.next);
  return Response.json({ ok: true });
});
