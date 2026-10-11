import { z } from 'zod';

import { reviewRedFlag } from '@/server/admin/moderation/red-flags';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['ok', 'hidden', 'warned']), reason: z.string().max(1000) });

/** Решение по флагу `{ decision: ok|hidden|warned, reason }`: hidden скрывает вакансию от кандидатов, warned — письмо компании. */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'review_red_flag');
  const { id } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await reviewRedFlag(staff, id, body.decision, body.reason));
});
