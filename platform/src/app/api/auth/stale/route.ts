import { NextResponse } from 'next/server';

import { safeNext } from '@/server/auth/redirect';
import { isSessionStale } from '@/server/auth/stale';
import { getEnv } from '@/server/env';
import { withErrors } from '@/server/errors';
import { clearedSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Страничный guard шлёт сюда, когда кука подписана верно, а аккаунта в БД нет: в Server Component
 * куки менять нельзя (docs Next.js 15: cookies().delete — только Server Action/Route Handler).
 * GET безопасен для CSRF: куку стирает, только если она и вправду протухла; живую сессию не трогает.
 */
export const GET = withErrors(async (req: Request) => {
  const next = safeNext(new URL(req.url).searchParams.get('next')) ?? '/';
  const stale = await isSessionStale(req);
  const res = NextResponse.redirect(new URL(stale ? `/auth?next=${encodeURIComponent(next)}` : next, getEnv().APP_URL), 303);
  if (stale) res.cookies.set(clearedSessionCookie());
  return res;
});
