import { loadEmployerContext, searchBank } from '@/server/employer';
import { parseFilters, searchParamsRecord } from '@/server/employer/schemas';
import { assertEmployerConsents } from '@/server/consent/service';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/employer/search?spec=&grade=&stack=&fsp=1&pool=all — поиск по всему банку (R-E-04). */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: поиск — после оферты и обязательства по данным
  const { filters, limit } = parseFilters(searchParamsRecord(new URL(req.url)));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await searchBank(ctx.companyId, filters, limit));
});
