import { assertSameOrigin } from '@/server/auth/csrf';
import { submitTurn } from '@/server/call';
import type { TurnTiming } from '@/server/call/service';
import { TurnBody } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/call/{id}/turn {text?, audioRef?} — реплика кандидата; в ответе следующая реплика ИИ
 * `{text, done}` (озвучивает клиент через /api/tts). Без text — сервер распознаёт сегмент audioRef.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const body = TurnBody.parse(await req.json().catch(() => ({})));
  const obs: { timing?: TurnTiming } = {};
  const result = await submitTurn(candidateId, id, body, getLlm({ candidateId }), obs);
  // Замер хода (лейн call-speed): видно в DevTools → Timing и в eval/call/latency.ts.
  const t = obs.timing;
  const timing = t ? [`llm;dur=${t.llmMs}`, ...(t.firstSentenceMs !== null ? [`first;dur=${t.firstSentenceMs}`] : [])].join(', ') : '';
  return Response.json(result, timing ? { headers: { 'server-timing': timing } } : undefined);
});
