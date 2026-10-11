import { requireStaff } from '@/server/admin/session';
import { ROLE_ACTIONS } from '@/server/admin/permissions';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Кто вошёл в админку: сотрудник, роль и список его прав (для интерфейса; решает всё равно сервер). */
export const GET = withErrors(async (req: Request) => {
  const staff = await requireStaff(req);
  return Response.json({ id: staff.staffId, name: staff.name, email: staff.email, role: staff.role, actions: [...ROLE_ACTIONS[staff.role]] });
});
