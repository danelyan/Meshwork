import { requireStaff } from '@/server/admin/session';
import { listSettings } from '@/server/admin/settings';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Настройки платформы: текущее значение, умолчание из кода, кто и когда менял (view_settings). */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'view_settings');
  return Response.json({ settings: (await listSettings()).filter((s) => !s.internal) });
});
