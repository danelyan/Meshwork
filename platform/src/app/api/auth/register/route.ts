import { z } from 'zod';

import { EmailSchema, PasswordSchema, registerWithEmail } from '@/server/auth/email';
import { parseAuthForm } from '@/server/auth/respond';
import { isDevRequest } from '@/server/devtools/guard';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().trim().max(120).optional(),
  /** Версия текста согласия из галки (R-C-14); без неё аккаунт не создаётся. */
  consent: z.string().min(1).max(64),
});

/** Регистрация по почте (R-D-04): код подтверждения уходит письмом. Ответ не раскрывает, занята ли почта. */
export const POST = withErrors(async (req: Request) => {
  const body = await parseAuthForm(req, Body);
  return Response.json(await registerWithEmail(body, { revealCode: isDevRequest(req) }));
});
