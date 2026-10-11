import { CALL_RECORDING_CONSENT_VERSION, callReadiness, callRecordingConsentText, callRecordingMode, listCalls } from '@/server/call';
import { CallListQuery } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/call?kind= – свои созвоны (свежие первыми) и состояние согласия на запись. `consent.mode`: audio – запись
 * идёт; text – согласие отозвано, созвон без записи голоса (ADR 0005); ask – спросить перед созвоном.
 */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const q = CallListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const [calls, mode, qualifying, interview] = await Promise.all([
    listCalls(candidateId, q.kind),
    callRecordingMode(candidateId),
    callReadiness(candidateId, 'qualifying'),
    callReadiness(candidateId, 'interview'),
  ]);
  return Response.json({
    consent: { given: mode === 'audio', mode, version: CALL_RECORDING_CONSENT_VERSION, text: await callRecordingConsentText() },
    calls,
    /** Можно ли начать созвон (readiness.ts): нет темы для разговора или пауза после прошлого. */
    readiness: { qualifying, interview },
  });
});
