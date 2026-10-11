import { matchingFunnel } from '@/server/admin/metrics/matching-monitor';
import { parseDays } from '@/server/admin/metrics/period';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Воронка приглашений по категориям за период (`?days=`). Только owner. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_metrics');
  const days = parseDays(new URL(req.url).searchParams.get('days'));
  return Response.json({ days, rows: await matchingFunnel(days) });
});
