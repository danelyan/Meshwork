import { assertEmployerConsents } from '@/server/consent/service';
import { loadEmployerContext } from '@/server/employer';
import { listVacancyApplications } from '@/server/employer/applications';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employer/vacancies/:id/applications – отклики на свою потребность (R-C-12). Карточка – как в подборке:
 * псевдоним до принятия, имя и контакты – после accepted и действующего раскрытия (R-E-07). Чужая – 404. `?view=1` отмечает просмотр.
 */
export const GET = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов – после оферты и обязательства
  const { id } = await params;
  const markViewed = new URL(req.url).searchParams.get('view') === '1';
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json({ applications: await listVacancyApplications(ctx.companyId, id, markViewed) });
});
