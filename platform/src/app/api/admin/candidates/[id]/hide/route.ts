import { z } from 'zod';

import { setCandidateHidden } from '@/server/admin/accounts/service';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const HideBody = z.object({ hidden: z.boolean(), reason: z.string().max(1000) });

/**
 * Скрыть кандидата из подборки и поиска (`hidden: true`) или вернуть (`false`) — owner, moderator. Скрытый
 * модератором профиль сам кандидат не возвращает; при возврате видимость — по его согласию Г4.
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'hide_candidate');
  const { id } = await ctx.params;
  const body = HideBody.parse(await req.json().catch(() => ({})));
  return Response.json(await setCandidateHidden(staff, id, body));
});
