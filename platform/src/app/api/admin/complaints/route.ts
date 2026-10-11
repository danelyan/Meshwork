import { z } from 'zod';

import { listComplaints } from '@/server/admin/moderation/complaints';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Q = z.enum(['open', 'upheld', 'dismissed', 'all']).catch('open');

/** Очередь жалоб кандидатов (`?status=open|upheld|dismissed|all`): приглашение, текст, история компании, санкция. Кандидаты — псевдонимы. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_complaints');
  const status = Q.parse(new URL(req.url).searchParams.get('status') ?? 'open');
  return Response.json({ complaints: await listComplaints(status) });
});
