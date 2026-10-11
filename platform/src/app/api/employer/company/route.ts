import { assertSameOrigin } from '@/server/auth/csrf';
import { CompanyPatch, getCompany, updateCompany } from '@/server/employer/company';
import { loadEmployerContext } from '@/server/employer/context';
import { companyInviteContactFor } from '@/server/employer/invitations';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employer/company — профиль своей компании (R-E-01). `inviteContact` — способ связи, который увидит
 * кандидат в приглашении от этого представителя (Company.contact, иначе его почта); null — приглашения не отправятся.
 */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const ctx = await loadEmployerContext(employerProfileId);
  const [company, inviteContact] = await Promise.all([getCompany(ctx.companyId), companyInviteContactFor(employerProfileId)]);
  return Response.json({ ...company, inviteContact });
});

/** PATCH /api/employer/company — частичная правка своей компании. */
export const PATCH = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const patch = CompanyPatch.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  const company = await updateCompany(ctx.companyId, patch);
  return Response.json({ ...company, inviteContact: await companyInviteContactFor(employerProfileId) });
});
