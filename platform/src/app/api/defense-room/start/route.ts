import { assertSameOrigin } from '@/server/auth/csrf';
import { startDefenseRoom } from '@/server/defense-room';
import { DefenseStartInput } from '@/server/defense-room/schemas';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST `{ mode: "project", projectSubmissionId }` | `{ mode: "questions" }` — начать защиту проекта
 * (CallSession.kind = defense, ADR 0003 ступень 3) или мини-сессию ответов на вопросы работодателей.
 * Читает репозиторий и готовит вопросы по коду (QLC) — до ~30 с. Активная сессия того же сабмита
 * возвращается (`resumed: true`). Ответ: `{ sessionId, resumed, webrtc: { iceServers }, snapshot }`.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const input = DefenseStartInput.parse(await req.json().catch(() => ({})));
  const res = await startDefenseRoom(candidateId, input, getLlm({ candidateId }));
  return Response.json(res, { status: res.resumed ? 200 : 201 });
});
