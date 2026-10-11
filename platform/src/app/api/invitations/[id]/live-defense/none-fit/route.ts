import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { rejectSlots } from '@/server/live-defense';
import { LiveNoneFitInput } from '@/server/live-defense/schemas';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** POST `{ comment }` — «ни один слот не подходит» (ADR 0008 п. 3): работодатель получает уведомление и предлагает новые. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const { comment } = LiveNoneFitInput.parse(await req.json().catch(() => ({})));
  return Response.json(await rejectSlots(candidateId, id, comment));
});
