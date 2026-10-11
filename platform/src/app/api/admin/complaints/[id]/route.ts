import { z } from 'zod';

import { resolveComplaint } from '@/server/admin/moderation/complaints';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['upheld', 'dismissed']), reason: z.string().max(1000) });

/**
 * Решение по жалобе `{ decision: upheld|dismissed, reason }`. Причина обязательна (400), повтор – 409. Под advisory-lock
 * отправки приглашений: отклонённая жалоба сразу перестаёт снижать лимит и индекс доверия. Письмо кандидату об итоге.
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'resolve_complaint');
  const { id } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await resolveComplaint(staff, id, body.decision, body.reason));
});
