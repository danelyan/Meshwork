import { assertEmployerConsents } from '@/server/consent/service';
import { assertSameOrigin } from '@/server/auth/csrf';
import { joinCall } from '@/server/defense-room';
import { JoinCallInput } from '@/server/defense-room/schemas';
import { withErrors } from '@/server/errors';
import { getSession, requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ recordingConsent: true }` – подключиться к живой защите кандидата (только после принятого приглашения, иначе 404).
 * Защита записывается целиком, включая голос работодателя (ADR 0008 п. 3): без `recordingConsent: true` – 409
 * `recording_consent_required`. В эфире одна компания: если подключена другая – 409 `room_busy`.
 * Ответ: `{ participantId, webrtc, snapshot }`.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const { userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов – после оферты и обязательства
  const { id } = await ctx.params;
  const body = JoinCallInput.parse(await req.json().catch(() => ({})));
  return Response.json(await joinCall(getSession(req), id, body));
});
