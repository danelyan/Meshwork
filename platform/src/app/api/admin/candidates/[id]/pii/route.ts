import { z } from 'zod';

import { revealCandidatePii } from '@/server/admin/overview/pii';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().max(1000) });

/**
 * Раскрыть ПДн: нужны право просмотра раздела и `reveal_pii`, причина обязательна, раскрытие пишется в журнал.
 * POST, а не GET: запрос оставляет след (журнал) и проходит CSRF-проверку.
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'view_candidates');
  const { id } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await revealCandidatePii(staff, id, body.reason));
});
