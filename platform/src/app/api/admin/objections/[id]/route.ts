import { z } from 'zod';

import { decideObjection } from '@/server/admin/moderation/objections';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['answer', 'review', 'annul']), text: z.string().max(4000) });

/**
 * Решение по возражению `{ decision: answer|review|annul, text }`: ответить кандидату; назначить пересмотр (итог даёт
 * другой сотрудник); аннулировать попытку теста с объяснением (категория по попытке снимается, вручную не ставится).
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'answer_objection');
  const { id } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await decideObjection(staff, id, body.decision, body.text));
});
