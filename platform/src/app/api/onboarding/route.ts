import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { loadUser, sessionInputFor } from '@/server/auth/users';
import { errors, withErrors } from '@/server/errors';
import { answerStep, finishLater, getView, gotoStep, skipStep } from '@/server/onboarding/service';
import { requireUser, userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

const StepId = z.string().regex(/^[A-Za-z]{1,40}$/);

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('answer'), stepId: StepId, value: z.unknown() }),
  z.object({ action: z.literal('skip'), stepId: StepId }),
  z.object({ action: z.literal('goto'), stepId: StepId }),
  z.object({ action: z.literal('later') }),
]);

/** Состояние онбординга: текущий шаг, лента, прогресс, итог (OnboardingView). */
export const GET = withErrors(async (req: Request) => {
  const { userId } = requireUser(req);
  return Response.json(await getView(userId, req.signal));
});

/**
 * Действие онбординга. answer/skip/goto → новый OnboardingView (+ новая кука, если
 * сменилась роль); later → { next } без завершения. Завершение – существующий
 * POST /api/auth/onboarding/complete (markOnboarded).
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  if (body.action === 'later') return Response.json(await finishLater(userId));

  const result =
    body.action === 'answer'
      ? await answerStep(userId, body.stepId, body.value)
      : body.action === 'skip'
        ? await skipStep(userId, body.stepId)
        : await gotoStep(userId, body.stepId);
  const res = NextResponse.json(await getView(userId, req.signal));
  if (result.sessionChanged) {
    const user = await loadUser(userId);
    if (!user) throw errors.unauthorized();
    res.cookies.set(userSessionCookie(sessionInputFor(user)));
  }
  return res;
});
