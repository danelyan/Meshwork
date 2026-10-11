import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { ADMIN_PRE_COOKIE, adminCookie, clearPreCookie, verifyPreToken } from '@/server/admin/session';
import { totpStep } from '@/server/admin/staff';
import { errors, withErrors } from '@/server/errors';
import { readCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

const AdminTotpBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Шесть цифр') });

/**
 * Вход персонала, шаг 2: код TOTP (RFC 6238, 6 цифр, шаг 30 с). Нужна кука fsp_admin_pre из шага 1.
 * Верный код → кука сессии fsp_admin и `{ next: "/admin" }`; при первом входе код включает TOTP.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const pre = verifyPreToken(readCookie(req, ADMIN_PRE_COOKIE));
  if (!pre) throw errors.unauthorized('Время на ввод кода истекло. Войдите заново.');
  const body = AdminTotpBody.parse(await req.json().catch(() => ({})));
  const { sessionId } = await totpStep(req, pre, body.code);
  const res = NextResponse.json({ next: '/admin' });
  res.cookies.set(adminCookie(sessionId));
  res.cookies.set(clearPreCookie());
  return res;
});
