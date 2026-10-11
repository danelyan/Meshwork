import { assertSameOrigin } from '@/server/auth/csrf';
import { startCall } from '@/server/call';
import { StartCallBody } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/call/start {kind, projectSubmissionId?} — начать созвон с ИИ (или продолжить активный).
 * Перед первым созвоном нужно согласие на запись (409 `call_consent_required`). kind=defense — lane defense-room.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const body = StartCallBody.parse(await req.json().catch(() => ({})));
  const result = await startCall(candidateId, body, getLlm({ candidateId, purpose: 'call' }));
  return Response.json(result, { status: result.resumed ? 200 : 201 });
});
