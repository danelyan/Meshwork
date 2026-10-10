import { assertSameOrigin } from '@/server/auth/csrf';
import { respondInvitation } from '@/server/employer';
import { InvitationAction } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invitations/:id `{ action: accept | decline, disclosureVersion? }` (R-C-11). accept — только с подтверждением
 * раскрытия имени и контактов этому работодателю (Г5, ADR 0005): без `disclosureVersion` — 409 `consent_required`.
 * Чужое — 404, повторный ответ — 409.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const { action, disclosureVersion } = InvitationAction.parse(await req.json().catch(() => ({})));
  return Response.json(await respondInvitation(candidateId, id, action, disclosureVersion));
});
