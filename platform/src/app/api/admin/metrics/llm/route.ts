import { llmByDay, llmByPurpose, nearCeiling } from '@/server/admin/metrics/llm-monitor';
import { parseDays } from '@/server/admin/metrics/period';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Расходы LLM за период: по purpose, по дням, кандидаты у потолка суточного бюджета (только id). Только owner. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_metrics');
  const days = parseDays(new URL(req.url).searchParams.get('days'));
  const [byPurpose, byDay, ceiling] = await Promise.all([llmByPurpose(days), llmByDay(days), nearCeiling()]);
  return Response.json({ days, byPurpose, byDay, nearCeiling: ceiling });
});
