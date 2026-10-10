import { z } from 'zod';

import { CodeSchema, EmailSchema, PasswordSchema, resetPassword } from '@/server/auth/email';
import { NextField, parseAuthForm, signedIn } from '@/server/auth/respond';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ email: EmailSchema, code: CodeSchema, password: PasswordSchema, next: NextField });

/** Новый пароль по коду из письма; после смены — вход. */
export const POST = withErrors(async (req: Request) => {
  const body = await parseAuthForm(req, Body);
  return signedIn(await resetPassword(body.email, body.code, body.password), body.next);
});
