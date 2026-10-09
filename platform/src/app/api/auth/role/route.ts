import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { chooseRole, sessionInputFor } from '@/server/auth/users';
import { withErrors } from '@/server/errors';
import { requireUser, userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('role', [
  z.object({ role: z.literal('candidate') }),
  z.object({ role: z.literal('employer'), companyName: z.string().trim().min(2).max(120) }),
]);

/** Выбор роли в онбординге (один раз). Перевыпускает куку с новой ролью. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const user = await chooseRole(userId, body);
  const res = NextResponse.json({ role: user.role, candidateId: user.candidateId, employerProfileId: user.employerProfile?.id ?? null });
  res.cookies.set(userSessionCookie(sessionInputFor(user)));
  return res;
});
