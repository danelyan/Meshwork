import { z } from 'zod';

import { listAppeals } from '@/server/admin/moderation/appeals';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Q = z.enum(['open', 'upheld', 'rejected', 'all']).catch('open');

/** Очередь апелляций работодателей на санкцию (`?status=…`): текст, текущая санкция и жалобы, на которых она держится. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_appeals');
  const status = Q.parse(new URL(req.url).searchParams.get('status') ?? 'open');
  return Response.json({ appeals: await listAppeals(status) });
});
