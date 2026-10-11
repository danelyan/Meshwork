import { assertSameOrigin } from '@/server/auth/csrf';
import { CandidateContactInput } from '@/server/contact';
import { getCandidateContact, setCandidateContact } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/profile/contact – способ связи кандидата (Q-35). */
export const GET = withErrors(async (req: Request) => Response.json(await getCandidateContact(requireCandidate(req))));

/** POST `{ contact }` – почта или Telegram; пустая строка или null – убрать. Компания увидит контакт только после принятия приглашения. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { contact } = CandidateContactInput.parse(await req.json().catch(() => ({})));
  return Response.json(await setCandidateContact(candidateId, contact));
});
