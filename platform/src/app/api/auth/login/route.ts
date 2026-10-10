import { z } from 'zod';

import { EmailSchema, loginWithEmail } from '@/server/auth/email';
import { NextField, parseAuthForm, signedIn } from '@/server/auth/respond';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

// Длину пароля при входе не проверяем по правилам регистрации: только защита от огромного тела.
const Body = z.object({ email: EmailSchema, password: z.string().min(1).max(256), next: NextField });

/** Вход по почте и паролю. Неверная почта или пароль — 401 invalid_credentials; почта не подтверждена — 403. */
export const POST = withErrors(async (req: Request) => {
  const body = await parseAuthForm(req, Body);
  return signedIn(await loginWithEmail(body.email, body.password), body.next);
});
