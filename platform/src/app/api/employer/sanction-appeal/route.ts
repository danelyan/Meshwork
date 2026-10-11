import { z } from 'zod';

import { createSanctionAppeal, listCompanyAppeals } from '@/server/admin/moderation/appeals';
import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext } from '@/server/employer/context';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().max(4000) });

/** GET /api/employer/sanction-appeal — апелляции своей компании на санкцию (новые сверху). */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json({ appeals: await listCompanyAppeals(ctx.companyId) });
});

/** POST /api/employer/sanction-appeal `{ text }` — оспорить санкцию. Санкции нет или апелляция уже открыта — 409. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await createSanctionAppeal(ctx, body.text), { status: 201 });
});
