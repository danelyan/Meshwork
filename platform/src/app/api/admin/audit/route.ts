import { z } from 'zod';

import { listAudit } from '@/server/admin/audit-feed';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const AuditQuery = z.object({
  actorId: z.string().max(64).optional(),
  action: z.string().max(80).optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(64).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Журнал действий персонала (только owner): лента новых сверху, фильтры по сотруднику, действию и объекту, курсор. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_audit');
  const q = AuditQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listAudit(q));
});
