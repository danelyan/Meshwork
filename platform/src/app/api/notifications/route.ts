import { z } from 'zod';
import { assertSameOrigin } from '@/server/auth/csrf';
import { markNotificationsRead, notifications } from '@/server/auth/notifications';
import { withErrors } from '@/server/errors';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';
export const GET = withErrors(async (req: Request) => Response.json(await notifications(requireUser(req))));
const Body = z.object({ through: z.iso.datetime() }).strict();
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const user = requireUser(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  await markNotificationsRead(user, new Date(body.through));
  return Response.json(await notifications(user));
});
