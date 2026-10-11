import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { cancelLiveDefense } from '@/server/live-defense';
import { LiveCancelInput } from '@/server/live-defense/schemas';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** POST `{ reason }` – отменить назначенную живую защиту не позднее чем за 1 час (ADR 0008 п. 6), иначе 409 `cancel_too_late`. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const { reason } = LiveCancelInput.parse(await req.json().catch(() => ({})));
  return Response.json(await cancelLiveDefense({ role: 'candidate', candidateId }, id, reason));
});
