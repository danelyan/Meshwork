import { z } from 'zod';

import { cleanupJunk, listDemo, setShowDemo } from '@/server/admin/accounts/service';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Ids = z.array(z.string().min(1).max(64)).max(500);
const DemoBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cleanup'), reason: z.string().max(1000), vacancyIds: Ids, companyIds: Ids }),
  z.object({ action: z.literal('show_demo'), value: z.boolean(), reason: z.string().max(1000) }),
]);

/** Демо-данные (owner): демо-пользователи и компании, мусор e2e, переключатель показа демо в подборке. */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'manage_demo');
  return Response.json(await listDemo());
});

/** `cleanup` — удалить показанный мусор e2e; `show_demo` — показывать ли демо-кандидатов в подборке и поиске. */
export const POST = withErrors(async (req: Request) => {
  const staff = await requireStaff(req, 'manage_demo');
  const body = DemoBody.parse(await req.json().catch(() => ({})));
  if (body.action === 'cleanup') return Response.json(await cleanupJunk(staff, body));
  return Response.json(await setShowDemo(staff, body));
});
