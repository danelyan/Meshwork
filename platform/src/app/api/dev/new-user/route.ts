import { NextResponse } from 'next/server';

import { newFreshUser } from '@/server/devtools/actions';
import { devRoute } from '@/server/devtools/route';
import { userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Новый демо-гость и вход за него (как «Новый пользователь» на /demo). Только localhost. */
export const POST = devRoute(async () => {
  const { user, session, next } = await newFreshUser();
  const res = NextResponse.json({ user: { id: user.id, name: user.name }, next });
  res.cookies.set(userSessionCookie(session));
  return res;
});
