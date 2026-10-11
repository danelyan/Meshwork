import { assertEmployerConsents } from '@/server/consent/service';
import { assertSameOrigin } from '@/server/auth/csrf';
import { joinCall } from '@/server/defense-room';
import { withErrors } from '@/server/errors';
import { getSession, requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — подключиться к живой защите кандидата (только после принятого приглашения, иначе 404).
 * В эфире одна компания: если подключена другая — 409 `room_busy`. Ответ: `{ participantId, webrtc, snapshot }`.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const { userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов — после оферты и обязательства
  const { id } = await ctx.params;
  return Response.json(await joinCall(getSession(req), id));
});
