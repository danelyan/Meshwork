import { NextResponse } from 'next/server';
import { z } from 'zod';

import { errors } from '@/server/errors';
import { userSessionCookie } from '@/server/session';

import { assertSameOrigin } from './csrf';
import { RATE, clientKey, hit } from './rate-limit';
import { safeNext } from './redirect';
import { homePathFor, type loadUser, needsOnboarding, sessionInputFor } from './users';

type LoadedUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

/** Общее начало форм входа по почте: CSRF, лимит на клиента, разбор тела Zod-схемой. */
export async function parseAuthForm<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  assertSameOrigin(req);
  if (!hit(`client:${clientKey(req)}`, RATE.perClient)) throw errors.rateLimited('Слишком много попыток. Подождите несколько минут.');
  return schema.parse(await req.json().catch(() => ({})));
}

/**
 * Успешный вход: новая кука сессии (ротация) и куда идти — незавершённый онбординг →
 * лента знакомства /consultant, иначе безопасный `next` или кабинет роли (как в callback Яндекса).
 */
export function signedIn(user: LoadedUser, next: string | null | undefined): Response {
  const home = homePathFor(user);
  const target = needsOnboarding(user) ? home : (safeNext(next) ?? home);
  const res = NextResponse.json({ next: target });
  res.cookies.set(userSessionCookie(sessionInputFor(user)));
  return res;
}

export const NextField = z.string().max(512).nullish();
