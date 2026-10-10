import { answerObjection, listOpenObjections } from '@/server/consent/objections';
import { ObjectionAnswerBody } from '@/server/consent/schemas';
import { devRoute, requireDevPrincipal } from '@/server/devtools/route';

export const dynamic = 'force-dynamic';

/** Открытые возражения против оценки (ст. 16) — для оператора. Только dev-хост. */
export const GET = devRoute(async (req) => {
  requireDevPrincipal(req);
  return Response.json({ objections: await listOpenObjections() });
});

/** Ответ оператора на возражение `{ id, answer }`. Только dev-хост. */
export const POST = devRoute(async (req) => {
  requireDevPrincipal(req);
  const body = ObjectionAnswerBody.parse(await req.json().catch(() => ({})));
  return Response.json(await answerObjection(body.id, body.answer));
});
