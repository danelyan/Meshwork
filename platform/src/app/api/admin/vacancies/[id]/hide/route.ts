import { z } from 'zod';

import { setVacancyHidden } from '@/server/admin/moderation/red-flags';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const HideBody = z.object({ hidden: z.boolean(), reason: z.string().max(1000) });

/**
 * Скрыть вакансию от кандидатов (`hidden: true`) или вернуть (`false`) – owner, moderator. Скрытие держится
 * в очереди красных флагов (hidden), поэтому разархивирование вакансии работодателем его не снимает.
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'hide_vacancy');
  const { id } = await ctx.params;
  const body = HideBody.parse(await req.json().catch(() => ({})));
  return Response.json(await setVacancyHidden(staff, id, body));
});
