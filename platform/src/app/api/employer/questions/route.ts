import { assertSameOrigin } from '@/server/auth/csrf';
import { assertEmployerConsents } from '@/server/consent/service';
import { createEmployerQuestion, listEmployerQuestions } from '@/server/defense-room';
import { EmployerQuestionInput, EmployerQuestionsQuery } from '@/server/defense-room/schemas';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET `?candidateId=` — вопросы компании кандидату: статус (queued → asked → answered) и ответ из транскрипта. */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов — после оферты и обязательства
  const q = EmployerQuestionsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json({ questions: await listEmployerQuestions(ctx, q.candidateId) });
});

/**
 * POST `{ candidateId, text, projectSubmissionId? }` — вопрос кандидату вне сессии: копится в очереди и
 * задаётся при следующем входе кандидата в защиту (если он сейчас на защите — в конце текущей).
 * Только после принятого приглашения; не больше 10 вопросов в очереди одному кандидату.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов — после оферты и обязательства
  const input = EmployerQuestionInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await createEmployerQuestion(ctx, input), { status: 201 });
});
