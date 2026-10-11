import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext, withdrawInvitation } from '@/server/employer';
import { WithdrawInvitationInput } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ reason }` — отозвать приглашение своей компании (lane invite-cancel): sent | viewed | accepted → withdrawn.
 * Чужое — 404; hired, declined, уже отозванное — 409 `invitation_not_withdrawable`. Закрывает слоты живой защиты
 * и прекращает раскрытие контактов; кандидат видит статус и причину. Лимит приглашений за сутки не возвращается.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId, userId } = requireEmployer(req);
  const { id } = await params;
  const { reason } = WithdrawInvitationInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await withdrawInvitation({ companyId: ctx.companyId, userId }, id, reason));
});
