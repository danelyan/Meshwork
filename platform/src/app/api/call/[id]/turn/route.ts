import { assertSameOrigin } from '@/server/auth/csrf';
import { submitTurn } from '@/server/call';
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
  return Response.json(await submitTurn(candidateId, id, body, getLlm({ candidateId })));
});
