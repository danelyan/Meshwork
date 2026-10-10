import { assertSameOrigin } from '@/server/auth/csrf';
import { relaySignal } from '@/server/defense-room';
import { SignalInput } from '@/server/defense-room/schemas';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ to?, sdp? , ice? }` — сигналинг WebRTC (ADR 0003): описание сессии или ICE-кандидат
 * доставляется собеседнику через его SSE (`signal`). Работодатель — подключённый участник, адресат —
 * кандидат; кандидат указывает `to: "employer:<userId>"`. Собеседник не на связи — 409 `peer_offline`.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  if (!getSession(req)) throw errors.unauthorized();
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const body = SignalInput.parse(await req.json().catch(() => ({})));
  return Response.json(
    await relaySignal(getSession(req), id, {
      ...(body.to ? { to: body.to } : {}),
      payload: { ...(body.sdp ? { description: body.sdp } : {}), ...(body.ice !== undefined ? { candidate: body.ice } : {}) },
    }),
  );
});
