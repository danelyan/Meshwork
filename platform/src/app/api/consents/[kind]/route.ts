import { assertSameOrigin } from '@/server/auth/csrf';
import { ConsentKindSchema, RevokeConsentQuery } from '@/server/consent/schemas';
import { revokeConsent } from '@/server/consent/service';
import { withErrors } from '@/server/errors';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/consents/{kind}?invitationId= — отозвать согласие (ADR 0005). pd_processing — 409
 * `consent_revoke_is_erase` (отзыв = удаление аккаунта, DELETE /api/auth/account). call_recording — аудио
 * удаляется сразу. identity_disclosure — по приглашению (`invitationId` обязателен): работодатель снова видит псевдоним.
 */
export const DELETE = withErrors(async (req: Request, { params }: { params: Promise<{ kind: string }> }) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  const kind = ConsentKindSchema.parse((await params).kind);
  const q = RevokeConsentQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await revokeConsent(userId, kind, q));
});
