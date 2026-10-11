import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/server/auth/csrf';
import { adminCookie, clearPreCookie } from '@/server/admin/session';
import { demoLogin } from '@/server/admin/staff';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * Демо-вход жюри в админку: только при DEMO_LOGIN (иначе 403). Без пароля и TOTP – сотрудник-owner
 * `demo-owner@admin.demo` с правом только на чтение; изменения и раскрытие ПДн отвечают 403.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { sessionId } = await demoLogin(req);
  const res = NextResponse.json({ next: '/admin' });
  res.cookies.set(adminCookie(sessionId));
  res.cookies.set(clearPreCookie());
  return res;
});
