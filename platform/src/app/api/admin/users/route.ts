import { listUsers } from '@/server/admin/overview/lists';
import { UserListQuery } from '@/server/admin/overview/queries';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';
import { can } from '@/server/admin/permissions';
export const dynamic = 'force-dynamic';

/** Список учётных записей: маски имени и почты, фильтры по роли, блокировке и демо; поиск по id (по почте и имени — тем, кто вправе раскрывать ПДн). */
export const GET = withErrors(async (req: Request) => {
  const staff = await requireStaff(req, 'view_users');
  const q = UserListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listUsers(q, can(staff.role, 'reveal_pii')));
});
