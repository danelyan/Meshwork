import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { type SessionPrincipal, getSession, requireUser } from '@/server/session';

import type { DevSession } from './actions';
import { assertDevRequest } from './guard';

/** Обёртка route handler'а дебаг-панели: не localhost / production → 404 до любой работы. */
export function devRoute(handler: (req: Request) => Promise<Response> | Response): (req: Request) => Promise<Response> {
  return withErrors(async (req: Request) => {
    assertDevRequest(req);
    if (req.method !== 'GET') assertSameOrigin(req);
    return handler(req);
  });
}

/** Любая сессия (включая старую куку кандидата без аккаунта); нет входа → 401. */
export function requireDevPrincipal(req: Request): SessionPrincipal {
  const s = getSession(req);
  if (!s) throw errors.unauthorized();
  return s;
}

/** Аккаунт из куки; старая кука без аккаунта → 401. */
export function requireDevSession(req: Request): DevSession {
  return requireUser(req);
}
