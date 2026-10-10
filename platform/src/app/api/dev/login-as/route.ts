import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ensureConsent } from '@/server/auth/consent';
import { ensureConsents } from '@/server/consent/service';
import { DEMO_EMPLOYER_CONSENTS, SHARED_DEMO_USER, ensureDemoCandidateUser, sessionInputFor } from '@/server/auth/users';
import { prisma } from '@/server/db';
import { listDemoAccounts } from '@/server/devtools/actions';
import { devRoute } from '@/server/devtools/route';
import { errors } from '@/server/errors';
import { userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Демо-аккаунты для переключателя. Только localhost. */
export const GET = devRoute(async () => Response.json(await listDemoAccounts()));

const Body = z.union([z.object({ candidateId: z.string().min(1).max(64) }), z.object({ employerUserId: z.string().min(1).max(64) })]);

/** Войти за демо-кандидата или демо-работодателя (не зависит от DEMO_LOGIN). Только localhost. */
export const POST = devRoute(async (req) => {
  const body = Body.parse(await req.json().catch(() => ({})));
  if ('employerUserId' in body) {
    const user = await prisma.user.findFirst({
      where: { id: body.employerUserId, ...SHARED_DEMO_USER, role: 'employer' },
      include: { employerProfile: { select: { id: true } } },
    });
    if (!user?.employerProfile) throw errors.notFound('Демо-работодатель не найден');
    await ensureConsent(user.id); // готовые демо-аккаунты считаются согласившимися
    await ensureConsents(user.id, DEMO_EMPLOYER_CONSENTS); // оферта и обязательство по данным (ADR 0005)
    const res = NextResponse.json({ next: '/consultant' });
    res.cookies.set(userSessionCookie(sessionInputFor(user)));
    return res;
  }
  const candidate = await prisma.candidate.findFirst({
    where: { id: body.candidateId, isDemo: true },
    select: { id: true, name: true, email: true },
  });
  if (!candidate) throw errors.notFound('Демо-кандидат не найден');
  const user = await ensureDemoCandidateUser(candidate);
  const res = NextResponse.json({ next: '/consultant' });
  res.cookies.set(userSessionCookie(sessionInputFor(user)));
  return res;
});
