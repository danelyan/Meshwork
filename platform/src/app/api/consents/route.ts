import { assertSameOrigin } from '@/server/auth/csrf';
import { GrantConsentBody } from '@/server/consent/schemas';
import { grantConsent, listConsents } from '@/server/consent/service';
import { withErrors } from '@/server/errors';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/consents — мои согласия (ADR 0005): вид, версия, дата, состояние; раскрытия — по приглашениям. */
export const GET = withErrors(async (req: Request) => {
  const { userId } = requireUser(req);
  return Response.json(await listConsents(userId));
});

/**
 * POST /api/consents `{ kind, version, context? }` — дать согласие текущей версии текста (повтор — без дубля).
 * identity_disclosure — с `context.invitationId` своего принятого приглашения. Устаревшая версия → 409.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  const body = GrantConsentBody.parse(await req.json().catch(() => ({})));
  const row = await grantConsent(userId, { kind: body.kind, version: body.version, context: body.context ?? null });
  return Response.json({ kind: row.kind, version: row.version, acceptedAt: row.acceptedAt.toISOString() }, { status: 201 });
});
