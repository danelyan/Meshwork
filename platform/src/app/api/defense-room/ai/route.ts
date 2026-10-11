import { assertSameOrigin } from '@/server/auth/csrf';
import { startAiDefense } from '@/server/defense-room';
import { AiDefenseStartInput } from '@/server/defense-room/schemas';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST `{ projectSubmissionId }` — ИИ-защита своего проверенного сабмита без приглашения (ADR 0008 п. 1): та же
 * комната `/defense-room/{sessionId}`, только вопросы по коду. Не чаще раза в сутки на сабмит (429 `ai_defense_limit`,
 * демо-кандидатов не ограничивает); идущая возвращается (`resumed: true`). Нужно согласие на запись (403 `call_consent_required`).
 * Работодатель до принятия приглашения видит только баллы и флаги.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const input = AiDefenseStartInput.parse(await req.json().catch(() => ({})));
  const res = await startAiDefense(candidateId, input.projectSubmissionId, getLlm({ candidateId }));
  return Response.json(res, { status: res.resumed ? 200 : 201 });
});
