import { assertEmployerConsents } from '@/server/consent/service';
import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext, markInvitationHired } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — отметить найм по своему принятому приглашению (accepted → hired, lane hired): финальный этап пути кандидата.
 * Чужое — 404, не принятое — 409; повторная отметка идемпотентна. Нанятый не показывается в поиске других компаний.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: действия с данными кандидатов — после оферты и обязательства
  const { id } = await params;
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await markInvitationHired(ctx.companyId, id));
});
