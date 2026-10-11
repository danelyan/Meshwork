import { NextResponse } from 'next/server';

import { clearAdminCookie, requireStaff } from '@/server/admin/session';
import { logout } from '@/server/admin/staff';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Выход персонала: сессия отзывается в БД, кука fsp_admin стирается. */
export const POST = withErrors(async (req: Request) => {
  const staff = await requireStaff(req);
  await logout(staff);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearAdminCookie());
  return res;
});
