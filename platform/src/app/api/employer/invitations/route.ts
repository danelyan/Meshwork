import { assertSameOrigin } from '@/server/auth/csrf';
import { createInvitation, invitationsSentToday, listCompanyInvitations, loadEmployerContext } from '@/server/employer';
import { InvitationInput } from '@/server/employer/schemas';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/employer/invitations — трекинг статусов (R-E-05) и остаток лимита за сутки. */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const ctx = await loadEmployerContext(employerProfileId);
  const [invitations, sent] = await Promise.all([listCompanyInvitations(ctx.companyId), invitationsSentToday(ctx.companyId)]);
  return Response.json({ invitations, limit: { perDay: DAILY_INVITATION_LIMIT, sentToday: sent } });
});

/** POST `{ candidateId, vacancyId?, message, salaryOffer }` — пригласить (зарплата обязательна). */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const input = InvitationInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await createInvitation(ctx, input), { status: 201 });
});
