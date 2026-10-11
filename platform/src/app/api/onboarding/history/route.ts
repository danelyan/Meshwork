import { withErrors } from '@/server/errors';
import { listAnswerHistory } from '@/server/onboarding/service';
import { requireCandidate, requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding/history — журнал редакций ответов опроса кандидата (C05): шаг, «было → стало» человеческим
 * текстом, когда и откуда (ответ, вход через ФСП ID, сброс). Только свои записи; работодателю недоступно.
 */
export const GET = withErrors(async (req: Request) => {
  requireCandidate(req);
  const { userId } = requireUser(req);
  return Response.json({ revisions: await listAnswerHistory(userId) });
});
