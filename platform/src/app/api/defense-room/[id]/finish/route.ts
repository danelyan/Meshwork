import { assertSameOrigin } from '@/server/auth/csrf';
import { finishDefenseRoom } from '@/server/defense-room';
import { withErrors } from '@/server/errors';
import { getLlm } from '@/server/llm';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST – завершить защиту: слепой оценщик по рубрике A-02, три прогона, медиана → `verdictJson`
 * `{ scores, total, passed, flags, summary, … }`. Повторный вызов возвращает сохранённый вердикт;
 * оценщик недоступен – 503, транскрипт сохранён, можно повторить.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  return Response.json({ verdict: await finishDefenseRoom(candidateId, id, getLlm({ candidateId })) });
});
