import { loadDashboard } from '@/server/admin/overview/dashboard';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Сводка дашборда админки: пользователи, категории, компании, воронка приглашений, очереди, расход LLM за сутки. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_dashboard');
  return Response.json(await loadDashboard());
});
