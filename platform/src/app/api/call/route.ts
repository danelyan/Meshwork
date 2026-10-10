import { CALL_RECORDING_CONSENT_PARAGRAPHS, CALL_RECORDING_CONSENT_VERSION, hasCallConsent, listCalls } from '@/server/call';
import { CallListQuery } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/call?kind= — свои созвоны (свежие первыми) и состояние согласия на запись. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const q = CallListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const [calls, consented] = await Promise.all([listCalls(candidateId, q.kind), hasCallConsent(candidateId)]);
  return Response.json({
    consent: { given: consented, version: CALL_RECORDING_CONSENT_VERSION, text: CALL_RECORDING_CONSENT_PARAGRAPHS },
    calls,
  });
});
