import { assertSameOrigin } from '@/server/auth/csrf';
import { candidateTurn } from '@/server/defense-room';
import { DefenseTurnInput } from '@/server/defense-room/schemas';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ text }` – ответ кандидата (голос распознаётся заранее через /api/stt). Ответ:
 * `{ text, muted, done }` – реплика ИИ (null, если работодатель замьютил ИИ). Реплики уходят и в SSE.
 * `done: true` – вопросы кончились, клиент вызывает finish. Второй ход параллельно – 409 busy.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  const body = DefenseTurnInput.parse(await req.json().catch(() => ({})));
  return Response.json(await candidateTurn(candidateId, id, body.text, getLlm({ candidateId })));
});
