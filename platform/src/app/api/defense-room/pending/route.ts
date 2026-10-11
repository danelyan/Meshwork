import { listCandidateSubmissions, pendingEmployerQuestions } from '@/server/defense-room';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET – вход в защиту для кандидата: сабмиты проектов с последней защитой и вопросы работодателей в очереди. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const [submissions, questions] = await Promise.all([listCandidateSubmissions(candidateId), pendingEmployerQuestions(candidateId)]);
  return Response.json({ submissions, questions });
});
