import { assertSameOrigin } from '@/server/auth/csrf';
import { homePathFor } from '@/server/auth/access';
import { markOnboarded } from '@/server/auth/users';
import { withErrors } from '@/server/errors';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Завершить онбординг: нужна роль и согласие текущей версии, иначе 409. Ответ — куда вести дальше. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  const user = await markOnboarded(userId);
  return Response.json({ onboarded: true, next: homePathFor(user.role) });
});
