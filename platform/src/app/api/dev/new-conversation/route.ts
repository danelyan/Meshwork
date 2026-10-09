import { devRoute, requireDevPrincipal } from '@/server/devtools/route';
import { startNewConversation } from '@/server/devtools/actions';

export const dynamic = 'force-dynamic';

/** Новый пустой разговор консультанта (кандидат) или помощника (работодатель). Только localhost. */
export const POST = devRoute(async (req) => {
  const s = requireDevPrincipal(req);
  return Response.json(await startNewConversation(s));
});
