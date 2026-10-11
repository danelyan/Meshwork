import { parseDays } from '@/server/admin/metrics/period';
import { RECALIBRATION_RULES, testItemStats } from '@/server/admin/metrics/test-monitor';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Монитор теста на грейд по заданиям за период (`?days=`, по умолчанию 30). Только owner. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_metrics');
  const days = parseDays(new URL(req.url).searchParams.get('days'));
  return Response.json({ days, rules: RECALIBRATION_RULES, items: await testItemStats(days) });
});
