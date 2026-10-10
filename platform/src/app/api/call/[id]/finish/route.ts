import { assertSameOrigin } from '@/server/auth/csrf';
import { finishCall } from '@/server/call';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Три прогона оценщика могут идти дольше обычного хода. */
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/call/{id}/finish — завершить созвон: слепой оценщик (3 прогона, медиана) строит карту
 * глубины; подтверждённые темы поднимают утверждения до platform. Повтор после 503 — пересчёт.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  return Response.json(await finishCall(candidateId, id, getLlm({ candidateId })));
});
