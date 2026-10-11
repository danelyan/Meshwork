import { z } from 'zod';

import { listVerification } from '@/server/admin/moderation/verification';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Q = z.enum(['pending', 'verified']).catch('pending');

/** Запросы на ручную проверку компаний (`?filter=pending|verified`): ИНН, название, основание (выписка или домен почты). */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_verification');
  const filter = Q.parse(new URL(req.url).searchParams.get('filter') ?? 'pending');
  return Response.json({ companies: await listVerification(filter) });
});
