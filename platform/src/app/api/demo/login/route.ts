import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { AppError, errors, withErrors } from '@/server/errors';
import { clearedSessionCookie, sessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

function assertEnabled() {
  if (!getEnv().DEMO_LOGIN_ENABLED) throw new AppError('forbidden', 'Демо-вход выключен', 403);
}

/** Список демо-кандидатов для экрана выбора. */
export const GET = withErrors(async () => {
  assertEnabled();
  const candidates = await prisma.candidate.findMany({
    where: { isDemo: true },
    select: { id: true, name: true, specialization: true, fspState: true },
    orderBy: { createdAt: 'asc' },
  });
  return Response.json({ candidates });
});

const LoginBody = z.object({ candidateId: z.string().min(1).max(64) });

/** Вход за демо-кандидата: ставит подписанную куку `cid`. Не-демо кандидаты — 404. */
export const POST = withErrors(async (req: Request) => {
  assertEnabled();
  const body = LoginBody.parse(await req.json().catch(() => ({})));
  const candidate = await prisma.candidate.findFirst({
    where: { id: body.candidateId, isDemo: true },
    select: { id: true, name: true },
  });
  if (!candidate) throw errors.notFound('Демо-кандидат не найден');
  const res = NextResponse.json({ candidate });
  res.cookies.set(sessionCookie(candidate.id));
  return res;
});

/** Выход. */
export const DELETE = withErrors(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearedSessionCookie());
  return res;
});
