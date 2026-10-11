import { z } from 'zod';

import { setTemplatePublished } from '@/server/admin/catalogs';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ published: z.boolean(), reason: z.string() });

/** PUT { published, reason } - опубликовать или снять шаблон задания теста (kind=task) или проекта (kind=project) (edit_catalogs). */
export const PUT = withErrors(async (req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) => {
  const staff = await requireStaff(req, 'edit_catalogs');
  const { kind, id } = await ctx.params;
  const k = z.enum(['task', 'project']).parse(kind);
  const body = Body.parse(await req.json().catch(() => ({})));
  await setTemplatePublished(k, id, body.published, staff, body.reason);
  return Response.json({ kind: k, id, published: body.published });
});
