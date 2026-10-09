import { resetTestAttempts } from '@/server/devtools/actions';
import { devRoute, requireDevPrincipal } from '@/server/devtools/route';

export const dynamic = 'force-dynamic';

/** Удалить попытки теста текущего кандидата. Только localhost. */
export const POST = devRoute(async (req) => {
  const s = requireDevPrincipal(req);
  return Response.json({ ok: true, deleted: await resetTestAttempts(s) });
});
