import { z } from 'zod';

import { decideVerification } from '@/server/admin/moderation/verification';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['verify', 'reject', 'revoke']), reason: z.string().max(1000) });

/** Решение по компании `[id]` `{ decision: verify|reject|revoke, reason }`: метка «компания проверена» видна кандидату на приглашении. */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'verify_company');
  const { id } = await ctx.params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await decideVerification(staff, id, body.decision, body.reason));
});
