import { NextResponse } from 'next/server';

import { deleteAccount } from '@/server/devtools/actions';
import { devRoute, requireDevPrincipal } from '@/server/devtools/route';
import { clearedSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Полностью удалить текущий аккаунт и его данные, разлогинить. Только localhost. */
export const POST = devRoute(async (req) => {
  const s = requireDevPrincipal(req);
  await deleteAccount(s);
  const res = NextResponse.json({ ok: true, next: '/' });
  res.cookies.set(clearedSessionCookie());
  return res;
});
