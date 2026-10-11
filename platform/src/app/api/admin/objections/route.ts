import { z } from 'zod';

import { listObjectionQueue } from '@/server/admin/moderation/objections';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Q = z.enum(['open', 'answered', 'all']).catch('open');

/** Возражения против автоматической оценки (152-ФЗ, ст. 16): открытые – по сроку ответа (30 дней), с предметом и часами до срока. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_objections');
  const status = Q.parse(new URL(req.url).searchParams.get('status') ?? 'open');
  return Response.json({ objections: await listObjectionQueue(status) });
});
