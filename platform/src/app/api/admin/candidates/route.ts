import { listCandidates } from '@/server/admin/overview/lists';
import { CandidateListQuery } from '@/server/admin/overview/queries';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';
import { can } from '@/server/admin/permissions';
export const dynamic = 'force-dynamic';

/** Список кандидатов: псевдоним вместо ФИО, текущая категория; поиск по id и псевдониму (по почте и имени – тем, кто вправе раскрывать ПДн). */
export const GET = withErrors(async (req: Request) => {
  const staff = await requireStaff(req, 'view_candidates');
  const q = CandidateListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listCandidates(q, can(staff.role, 'reveal_pii')));
});
