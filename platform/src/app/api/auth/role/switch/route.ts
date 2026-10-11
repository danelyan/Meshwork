import { NextResponse } from 'next/server';
import { z } from 'zod';

import { homePathFor } from '@/server/auth/access';
import { assertSameOrigin } from '@/server/auth/csrf';
import { RATE, hit } from '@/server/auth/rate-limit';
import { switchRole } from '@/server/auth/role-switch';
import { sessionInputFor } from '@/server/auth/users';
import { errors, withErrors } from '@/server/errors';
import { getSession, requireUser, userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('role', [
  z.object({ role: z.literal('candidate') }),
  // Название нужно, только когда профиля работодателя ещё нет (создаётся новая компания); пустая строка – как отсутствие.
  z.object({ role: z.literal('employer'), companyName: z.union([z.literal(''), z.string().trim().min(2).max(120)]).optional() }),
]);

/**
 * Переключить активную роль учётки (ADR 0004). Профиль целевой роли есть – переключает; нет – создаёт его
 * (работодателю – с новой компанией) и запускает знакомство этой роли в ленте /consultant. Та же роль –
 * идемпотентно. Перевыпускает куку `cid` (в ней id профиля только активной роли); клиент ведёт на `next`
 * полной навигацией.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  if (getSession(req)?.userId === null) {
    throw errors.forbidden('Старый демо-вход без аккаунта не переключает роль: войдите заново на странице /demo');
  }
  const { userId } = requireUser(req);
  if (!hit(`role-switch:${userId}`, RATE.roleSwitch)) throw errors.rateLimited('Слишком много переключений. Подождите несколько минут.');
  const body = Body.parse(await req.json().catch(() => ({})));
  const request = body.role === 'employer' ? { role: body.role, companyName: body.companyName || undefined } : body;
  const { user, created, changed } = await switchRole(userId, request);
  const res = NextResponse.json({ role: user.role, next: homePathFor(user.role), created, changed });
  res.cookies.set(userSessionCookie(sessionInputFor(user)));
  return res;
});
