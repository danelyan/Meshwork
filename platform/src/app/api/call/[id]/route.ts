import { callPrincipal, getCallForViewer } from '@/server/call';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/call/{id} — статус, транскрипт и вердикт с учётом роли: кандидату — всё; работодателю до
 * принятого приглашения — только оценки по темам (`access: summary`), после — всё.
 */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const who = callPrincipal(req);
  const { id } = await params;
  const { view } = await getCallForViewer(who, id);
  return Response.json(view);
});
