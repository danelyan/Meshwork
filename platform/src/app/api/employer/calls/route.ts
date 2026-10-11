import { assertEmployerConsents } from '@/server/consent/service';
import { listEmployerCalls } from '@/server/defense-room';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET — защиты проектов кандидатов, принявших приглашение компании: идущие сейчас сверху, с оценкой и флагами. */
export const GET = withErrors(async (req: Request) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов — после оферты и обязательства
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json({ calls: await listEmployerCalls(ctx) });
});
