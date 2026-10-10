import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { ProjectTaskInput } from '@/server/project/schemas';
import { getEmployerTask, upsertProjectTask } from '@/server/project/service';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/employer/needs/:id/project — проектное задание потребности (условие, рубрика, шаблон) или `{ task: null }`. */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json({ task: await getEmployerTask(ctx.companyId, id) });
});

/**
 * POST `{ templateId?, subcategoryId?, requiredCatalogIds[], wishesText?, visibility?, deadlineDays? }` — создать или
 * перегенерировать задание (ADR 0003, ступень 2): ИИ пишет условие в домене потребности поверх фиксированного контракта
 * шаблона, рубрика — из обязательных критериев каталога и пожеланий. После первого сабмита — 409.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const input = ProjectTaskInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await upsertProjectTask(ctx, id, input), { status: 201 });
});
