import { assertEmployerConsents } from '@/server/consent/service';
import { loadEmployerContext } from '@/server/employer';
import { errors, withErrors } from '@/server/errors';
import { listEmployerSubmissions } from '@/server/project/service';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employer/project-submissions?needId= – сдачи проектного задания потребности: псевдоним до принятого
 * приглашения (R-C-16), автопроверка (балл скрытых тестов), таблица «критерий → прошёл/нет → доказательство».
 */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов – после оферты и обязательства
  const needId = new URL(req.url).searchParams.get('needId');
  if (!needId) throw errors.badRequest('Нужен needId');
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await listEmployerSubmissions(ctx.companyId, needId));
});
