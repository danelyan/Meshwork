import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { eraseOwnAccount } from '@/server/auth/erase-account';
import { withErrors } from '@/server/errors';
import { clearedSessionCookie, requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';
const Body = z.object({ confirmation: z.literal('УДАЛИТЬ'), reason: z.enum(['delete', 'withdraw']) }).strict();

/** Delete the authenticated account, both profiles and stored files, then clear its session. */
export const DELETE = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  Body.parse(await req.json().catch(() => ({})));
  await eraseOwnAccount(userId);
  const response = NextResponse.json({ ok: true, next: '/' });
  response.cookies.set(clearedSessionCookie());
  return response;
});
