import { assertSameOrigin } from '@/server/auth/csrf';
import { recordCallConsent } from '@/server/call';
import { CallConsentBody } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** POST /api/call/consent {version} – согласие на запись созвона (транскрипт и аудио). Повтор – без дубля. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const body = CallConsentBody.parse(await req.json().catch(() => ({})));
  return Response.json(await recordCallConsent(candidateId, body.version), { status: 201 });
});
