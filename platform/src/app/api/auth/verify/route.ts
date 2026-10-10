import { z } from 'zod';

import { CodeSchema, EmailSchema, verifyEmail } from '@/server/auth/email';
import { NextField, parseAuthForm, signedIn } from '@/server/auth/respond';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ email: EmailSchema, code: CodeSchema, next: NextField });

/** Код из письма → почта подтверждена, вход (кука `cid`). */
export const POST = withErrors(async (req: Request) => {
  const body = await parseAuthForm(req, Body);
  return signedIn(await verifyEmail(body.email, body.code), body.next);
});
