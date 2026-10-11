import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { startConfirmAttempt } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * POST /api/test/attempt/[id]/confirm-start – подтверждающий тест к попытке в статусе needs_confirmation
 * (ADR-0002, дополнение 11.10): новая попытка kind=confirm (201) или продолжение активной (200).
 * 409: confirm_not_needed, already_confirmed, confirm_used, active_attempt.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  const result = await startConfirmAttempt(candidateId, id);
  return Response.json(result, { status: result.resumed ? 200 : 201 });
});
