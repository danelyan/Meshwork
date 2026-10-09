import { NextResponse } from 'next/server';

import { devRoute } from '@/server/devtools/route';
import { clearedSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Выйти. Только localhost. */
export const POST = devRoute(async () => {
  const res = NextResponse.json({ ok: true, next: '/' });
  res.cookies.set(clearedSessionCookie());
  return res;
});
