import { z } from 'zod';

import { EmailSchema, requestPasswordReset } from '@/server/auth/email';
import { parseAuthForm } from '@/server/auth/respond';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ email: EmailSchema });

/** Код сброса пароля письмом. Всегда 200 `{ sent: true }`: не раскрываем, есть ли аккаунт. */
export const POST = withErrors(async (req: Request) => {
  const body = await parseAuthForm(req, Body);
  return Response.json(await requestPasswordReset(body.email));
});
