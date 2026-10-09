import { loadEmployerContext, searchBank } from '@/server/employer';
import { parseFilters, searchParamsRecord } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/employer/search?spec=&grade=&stack=&fsp=1&category=1 — поиск по всему банку (R-E-04). */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const { filters, limit } = parseFilters(searchParamsRecord(new URL(req.url)));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await searchBank(ctx.companyId, filters, limit));
});
