import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/server/auth/csrf';
import { getEnv } from '@/server/env';
import { withErrors } from '@/server/errors';
import { clearedSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Выход: только POST (GET-выход можно дёрнуть картинкой с чужого сайта).
 * HTML-форма (Accept: text/html) → 303 на /auth, fetch → JSON.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
  const res = wantsHtml
    ? NextResponse.redirect(new URL('/auth', getEnv().APP_URL), 303)
    : NextResponse.json({ ok: true });
  res.cookies.set(clearedSessionCookie());
  return res;
});
