import { z } from 'zod';

import { resolveAppeal } from '@/server/admin/moderation/appeals';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['upheld', 'rejected']), reason: z.string().max(1000), complaintIds: z.array(z.string().min(1).max(64)).max(200).optional() });

/**
 * Решение по апелляции `{ decision: upheld|rejected, reason, complaintIds? }`. upheld отклоняет выбранные открытые жалобы
 * компании за окно (по умолчанию все) под advisory-lock отправки; rejected санкцию не меняет. Письмо работодателю об итоге.
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'resolve_appeal');
  const { id } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await resolveAppeal(staff, id, body.decision, body.reason, body.complaintIds));
});
