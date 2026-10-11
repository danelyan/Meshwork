import { z } from 'zod';

import { companyVerification, requestVerification } from '@/server/admin/moderation/verification';
import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext } from '@/server/employer/context';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ method: z.enum(['egrul', 'email_domain']), text: z.string().max(2000).default('') });

/** GET /api/employer/company/verification – статус ручной проверки своей компании. */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await companyVerification(ctx.companyId));
});

/** POST /api/employer/company/verification `{ method: egrul|email_domain, text }` – запросить проверку модератором. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await requestVerification(ctx, body));
});
