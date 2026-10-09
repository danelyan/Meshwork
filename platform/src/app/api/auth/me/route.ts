import { hasCurrentConsent } from '@/server/auth/consent';
import { loadUser } from '@/server/auth/users';
import { withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Текущий вход. `{ user: null }` — не вошёл. Старая кука демо-кандидата без
 * аккаунта → `{ user: null, legacyCandidateId }`.
 */
export const GET = withErrors(async (req: Request) => {
  const s = getSession(req);
  if (!s) return Response.json({ user: null });
  if (!s.userId) return Response.json({ user: null, legacyCandidateId: s.candidateId });
  const user = await loadUser(s.userId);
  if (!user) return Response.json({ user: null });
  return Response.json({
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      isDemo: user.isDemo,
      candidateId: user.candidateId,
      employerProfileId: user.employerProfile?.id ?? null,
      onboarded: user.onboardedAt !== null,
      consent: await hasCurrentConsent(user.id),
    },
  });
});
