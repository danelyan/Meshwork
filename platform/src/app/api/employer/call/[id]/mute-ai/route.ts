import { assertSameOrigin } from '@/server/auth/csrf';
import { muteAi } from '@/server/defense-room';
import { MuteAiInput } from '@/server/defense-room/schemas';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { getSession, requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ muted }` – «ИИ молчит / говорит»: пока замьючен, ИИ не вступает после ответов кандидата.
 * Размьют: если последним говорил кандидат, ИИ продолжает по плану (`aiText`). Нужно подключиться (join).
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  requireEmployer(req);
  const { id } = await ctx.params;
  const body = MuteAiInput.parse(await req.json().catch(() => ({})));
  return Response.json(await muteAi(getSession(req), id, body.muted, getLlm({ purpose: 'call' })));
});
