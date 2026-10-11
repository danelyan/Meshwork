import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { actOnResumeField, ResumeFieldAction, resumeFieldsView } from '@/server/resume-fields';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/profile/resume-fields — что в профиле взято из резюме и где резюме расходится с профилем (R-C-01/02). Только кандидату. */
export const GET = withErrors(async (req: Request) => Response.json({ fields: await resumeFieldsView(requireCandidate(req)) }));

/**
 * POST `{ action: 'accept' | 'dismiss', key }` — принять или отклонить «в резюме указано иначе»;
 * `{ action: 'set', key: 'name' | 'experienceYears' | 'roles' | 'softSkills', value }` — поправить поле самому.
 * Контакт правится через POST /api/profile/contact.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const input = ResumeFieldAction.parse(await req.json().catch(() => ({})));
  return Response.json({ fields: await actOnResumeField(candidateId, input) });
});
