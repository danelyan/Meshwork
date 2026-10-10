import { withErrors } from '@/server/errors';
import { listTemplateViews } from '@/server/project/service';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/employer/project-templates?specialization=&grade= — базовые шаблоны проектов (контракт и скрытые тесты фиксированы). */
export const GET = withErrors(async (req: Request) => {
  requireEmployer(req);
  const url = new URL(req.url);
  const specialization = url.searchParams.get('specialization') ?? undefined;
  const grade = url.searchParams.get('grade') ?? undefined;
  return Response.json({ templates: listTemplateViews({ specialization, grade }) });
});
