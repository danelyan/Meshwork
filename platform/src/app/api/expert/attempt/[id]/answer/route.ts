import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { assertExpertEnabled, expertView, requireExpert } from '@/server/expert';
import { answerAttempt } from '@/server/test';
import { MAX_ANSWER_CHARS } from '@/server/test/answers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const Body = z.object({ answer: z.string().max(MAX_ANSWER_CHARS * 4) });

/** POST /api/expert/attempt/[id]/answer {answer} – ответ эксперта → следующее задание или итог с разбором (категория не пишется). */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  assertExpertEnabled();
  const candidateId = await requireExpert(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await expertView(candidateId, await answerAttempt(candidateId, id, body.answer)));
});
