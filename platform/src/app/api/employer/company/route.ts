import { assertSameOrigin } from '@/server/auth/csrf';
import { CompanyPatch, getCompany, updateCompany } from '@/server/employer/company';
import { loadEmployerContext } from '@/server/employer/context';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/employer/company — профиль своей компании (R-E-01). */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await getCompany(ctx.companyId));
});

/** PATCH /api/employer/company — частичная правка своей компании. */
export const PATCH = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const patch = CompanyPatch.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await updateCompany(ctx.companyId, patch));
});
