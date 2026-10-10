import { z } from 'zod';

import { EmailSchema, resendVerifyCode } from '@/server/auth/email';
import { parseAuthForm } from '@/server/auth/respond';
import { isDevRequest } from '@/server/devtools/guard';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ email: EmailSchema });

/** Выслать код подтверждения заново. Ответ одинаковый для любой почты. */
export const POST = withErrors(async (req: Request) => {
  const body = await parseAuthForm(req, Body);
  return Response.json(await resendVerifyCode(body.email, { revealCode: isDevRequest(req) }));
});
