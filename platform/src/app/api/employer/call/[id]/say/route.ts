import { assertSameOrigin } from '@/server/auth/csrf';
import { employerSay } from '@/server/defense-room';
import { SayInput } from '@/server/defense-room/schemas';
import { withErrors } from '@/server/errors';
import { getSession, requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ text }` — реплика работодателя в живой защите: попадает в транскрипт (role employer) и
 * озвучивается кандидату вторым голосом TTS, если P2P-аудио не поднялось. Нужно подключиться (join).
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  requireEmployer(req);
  const { id } = await ctx.params;
  const body = SayInput.parse(await req.json().catch(() => ({})));
  return Response.json(await employerSay(getSession(req), id, body.text), { status: 201 });
});
