import { assertSameOrigin } from '@/server/auth/csrf';
import { leaveCall } from '@/server/defense-room';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { getSession, requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST — выйти из защиты. Если работодатель держал ИИ замьюченным — ИИ снова говорит. */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  requireEmployer(req);
  const { id } = await ctx.params;
  return Response.json(await leaveCall(getSession(req), id, getLlm()));
});
