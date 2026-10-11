import { z } from 'zod';

import { listRedFlags } from '@/server/admin/moderation/red-flags';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Q = z.enum(['open', 'ok', 'hidden', 'warned', 'all']).catch('open');

/** Очередь красных флагов (`?status=…`): приглашения и вакансии, где сработал detectRedFlags. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_red_flags');
  const status = Q.parse(new URL(req.url).searchParams.get('status') ?? 'open');
  return Response.json({ redFlags: await listRedFlags(status) });
});
