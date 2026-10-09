import { NextResponse } from 'next/server';
import { z } from 'zod';

import { newFreshUser } from '@/server/devtools/actions';
import { devRoute } from '@/server/devtools/route';
import { userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Новый демо-гость и вход за него (как «Новый пользователь» на /demo). Только localhost. */
const Body = z.object({ consent: z.string().min(1).max(64).optional() });

/** Как и на /demo, без согласия (версия текста в теле) пользователь не создаётся — 409. */
export const POST = devRoute(async (req) => {
  const body = Body.parse(await req.json().catch(() => ({})));
  const { user, session, next } = await newFreshUser(body.consent);
  const res = NextResponse.json({ user: { id: user.id, name: user.name }, next });
  res.cookies.set(userSessionCookie(session));
  return res;
});
