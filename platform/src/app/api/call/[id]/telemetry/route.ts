import { assertSameOrigin } from '@/server/auth/csrf';
import { recordTurnTelemetry } from '@/server/call';
import { TelemetryBody } from '@/server/call/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/call/{id}/telemetry {index, client} — водопад хода из браузера (конец речи → загрузка → первое
 * предложение → реплика → первый звук, ack). Дописывается в timing.client реплики ИИ; на оценку не влияет.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const body = TelemetryBody.parse(await req.json().catch(() => ({})));
  return Response.json(await recordTurnTelemetry(candidateId, id, body));
});
