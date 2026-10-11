import { assertSameOrigin } from '@/server/auth/csrf';
import { createObjection, listObjections } from '@/server/consent/objections';
import { ObjectionBody } from '@/server/consent/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/objections – мои возражения против оценки (ст. 16 152-ФЗ) со сроком ответа. Работодателю недоступно. */
export const GET = withErrors(async (req: Request) => Response.json({ objections: await listObjections(requireCandidate(req)) }));

/** POST /api/objections `{ subject: grade_test|call|defense, subjectId, text }` – оспорить оценку; ответ в течение 30 дней. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const body = ObjectionBody.parse(await req.json().catch(() => ({})));
  return Response.json(await createObjection(candidateId, body), { status: 201 });
});
