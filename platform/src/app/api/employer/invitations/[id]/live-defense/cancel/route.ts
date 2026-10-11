import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { cancelLiveDefense } from '@/server/live-defense';
import { LiveCancelInput } from '@/server/live-defense/schemas';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ reason }` — отменить живую защиту или предложение слотов (ADR 0008 п. 6). Назначенную — не позднее чем за 1 час
 * (иначе 409 `cancel_too_late`). Кандидат получает уведомление; затем можно предложить новые слоты.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId, userId } = requireEmployer(req);
  const { id } = await params;
  const { reason } = LiveCancelInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await cancelLiveDefense({ role: 'employer', companyId: ctx.companyId, userId }, id, reason));
});
