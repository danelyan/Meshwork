import { assertSameOrigin } from '@/server/auth/csrf';
import { interruptAi } from '@/server/call';
import { InterruptBody } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/call/{id}/interrupt {index, heardSentences} – кандидат заговорил, пока ИИ говорил (режим звонка).
 * Реплика ИИ в транскрипте обрезается до услышанных предложений, хвост остаётся интервьюеру как недосказанное.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const body = InterruptBody.parse(await req.json().catch(() => ({})));
  return Response.json(await interruptAi(candidateId, id, body));
});
