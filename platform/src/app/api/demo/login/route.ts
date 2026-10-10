import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ensureConsent } from '@/server/auth/consent';
import { createFreshDemoUser, ensureDemoCandidateUser, resetDemoOnboarding, sessionInputFor } from '@/server/auth/users';
import { prisma } from '@/server/db';
import { demoResumeFor } from '@/server/demo/resumes';
import { getEnv } from '@/server/env';
import { errors, withErrors } from '@/server/errors';
import { clearedSessionCookie, userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

function assertEnabled() {
  if (!getEnv().DEMO_LOGIN) throw errors.notFound();
}

/** Список демо-кандидатов и демо-работодателей для экрана выбора. */
export const GET = withErrors(async () => {
  assertEnabled();
  const candidates = await prisma.candidate.findMany({
    where: { isDemo: true },
    select: { id: true, name: true, specialization: true, fspState: true },
    orderBy: { createdAt: 'asc' },
  });
  const employers = await prisma.user.findMany({
    where: { isDemo: true, role: 'employer', employerProfile: { isNot: null } },
    select: { id: true, name: true, employerProfile: { select: { company: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  // Подсказка для экрана входа: какой файл загрузить и какую ссылку вставить (eval/demo/demo-N).
  return Response.json({
    candidates: candidates.map((c) => {
      const r = demoResumeFor(c.id);
      return { ...c, demoResume: r ? { fileName: r.fileName, link: r.link } : null };
    }),
    employers: employers.map((e) => ({ id: e.id, name: e.name, company: e.employerProfile?.company ?? null })),
  });
});

const LoginBody = z.union([
  // Новый пользователь — только с галкой согласия (версия текста; решение владельца 09.10).
  z.object({ fresh: z.literal(true), consent: z.string().min(1).max(64) }),
  z.object({ restartUserId: z.string().min(1).max(64) }),
  z.object({ restartCandidateId: z.string().min(1).max(64) }),
  z.object({ candidateId: z.string().min(1).max(64) }),
  z.object({ employerUserId: z.string().min(1).max(64) }),
]);

/**
 * Вход за демо-кандидата (`{ candidateId }`) или демо-работодателя
 * (`{ employerUserId }`): подписанная кука `cid` аккаунта (lane auth). Демо-кандидату
 * аккаунт создаётся при первом входе. Не-демо — 404.
 */
export const POST = withErrors(async (req: Request) => {
  assertEnabled();
  const body = LoginBody.parse(await req.json().catch(() => ({})));
  if ('fresh' in body) {
    // Новый пользователь: согласие уже взято галкой на /demo (в createFreshDemoUser), роль спросит онбординг.
    const user = await createFreshDemoUser(body.consent);
    const res = NextResponse.json({ user: { id: user.id, name: user.name }, next: '/consultant' });
    res.cookies.set(userSessionCookie(sessionInputFor(user)));
    return res;
  }
  if ('restartUserId' in body || 'restartCandidateId' in body) {
    let userId: string;
    if ('restartUserId' in body) {
      userId = body.restartUserId;
    } else {
      const candidate = await prisma.candidate.findFirst({
        where: { id: body.restartCandidateId, isDemo: true },
        select: { id: true, name: true, email: true },
      });
      if (!candidate) throw errors.notFound('Демо-кандидат не найден');
      userId = (await ensureDemoCandidateUser(candidate)).id;
    }
    const user = await resetDemoOnboarding(userId);
    const res = NextResponse.json({ user: { id: user.id, name: user.name }, next: '/consultant' });
    res.cookies.set(userSessionCookie(sessionInputFor(user)));
    return res;
  }
  if ('employerUserId' in body) {
    const user = await prisma.user.findFirst({
      where: { id: body.employerUserId, isDemo: true, role: 'employer' },
      include: { employerProfile: { select: { id: true } } },
    });
    if (!user?.employerProfile) throw errors.notFound('Демо-работодатель не найден');
    await ensureConsent(user.id); // готовые демо-аккаунты считаются согласившимися
    const res = NextResponse.json({ employer: { id: user.id, name: user.name }, next: '/employer' });
    res.cookies.set(userSessionCookie(sessionInputFor(user)));
    return res;
  }
  const candidate = await prisma.candidate.findFirst({
    where: { id: body.candidateId, isDemo: true },
    select: { id: true, name: true, email: true },
  });
  if (!candidate) throw errors.notFound('Демо-кандидат не найден');
  const user = await ensureDemoCandidateUser(candidate);
  const res = NextResponse.json({ candidate: { id: candidate.id, name: candidate.name }, next: '/consultant' });
  res.cookies.set(userSessionCookie(sessionInputFor(user)));
  return res;
});

/** Выход. */
export const DELETE = withErrors(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearedSessionCookie());
  return res;
});
