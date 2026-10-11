import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { preCookie } from '@/server/admin/session';
import { passwordStep } from '@/server/admin/staff';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const AdminLoginBody = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(256) });

/**
 * Вход персонала, шаг 1: почта и пароль. Верно → промежуточная кука fsp_admin_pre (5 минут) и следующий шаг:
 * `totp` – ввести код, `setup` – TOTP ещё не настроен, в ответе секрет и otpauth-URI для приложения-аутентификатора.
 * Неверная пара или отключённый сотрудник – 401 без уточнения.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const body = AdminLoginBody.parse(await req.json().catch(() => ({})));
  const r = await passwordStep(req, body.email, body.password);
  const res = NextResponse.json(r.step === 'setup' ? { step: r.step, secret: r.secret, otpauthUri: r.otpauthUri } : { step: r.step });
  res.cookies.set(preCookie(r.staffId, r.pv));
  return res;
});
