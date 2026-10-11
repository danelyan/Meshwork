import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { answerDefense, DEFENSE_LIMITS, getDefenseSession } from '@/server/defense';
import { errors, withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string }> };

const SessionId = z.string().min(1).max(64);
// Пустой ответ допустим («не знаю» честно оценивается); длину режет и сервис.
const AnswerBody = z.object({ answer: z.string().max(DEFENSE_LIMITS.maxAnswerChars + 2000) });

/** GET /api/defense/[sessionId] — состояние сессии (вопросы, ответы, вердикт). Чужая — 404. */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  const candidateId = requireCandidate(req);
  const { sessionId } = await ctx.params;
  if (!SessionId.safeParse(sessionId).success) throw errors.notFound('Сессия защиты не найдена');
  return Response.json(await getDefenseSession(candidateId, sessionId));
});

/** POST /api/defense/[sessionId] {answer} — ответ на текущий вопрос → следующий вопрос или вердикт. */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { sessionId } = await ctx.params;
  if (!SessionId.safeParse(sessionId).success) throw errors.notFound('Сессия защиты не найдена');
  const body = AnswerBody.parse(await req.json().catch(() => ({})));
  const result = await answerDefense(candidateId, sessionId, body.answer, getLlm({ candidateId }));
  return Response.json(result);
});
