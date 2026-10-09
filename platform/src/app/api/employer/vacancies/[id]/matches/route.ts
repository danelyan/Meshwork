import { loadEmployerContext, matchForVacancy } from '@/server/employer';
import { parseFilters, searchParamsRecord } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employer/vacancies/:id/matches?spec=&grade=&stack=a,b&fsp=1&category=1&limit=
 * Подборка с обоснованием (R-E-03, R-M-03); фильтры — query (R-M-04). Контакты скрыты до принятия (R-E-07).
 */
export const GET = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const { filters, limit } = parseFilters(searchParamsRecord(new URL(req.url)));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await matchForVacancy(ctx.companyId, id, filters, limit));
});
