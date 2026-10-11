import { acceptedByRank, matchingFunnel } from '@/server/admin/metrics/matching-monitor';
import { parseDays } from '@/server/admin/metrics/period';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Воронка приглашений по категориям за период (`?days=`) и доля принятых по рангу в подборке (`byRank`: ≤ 3, ≤ 10, > 10, без ранга). Только owner. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_metrics');
  const days = parseDays(new URL(req.url).searchParams.get('days'));
  const [rows, byRank] = await Promise.all([matchingFunnel(days), acceptedByRank(days)]);
  return Response.json({ days, rows, byRank });
});
