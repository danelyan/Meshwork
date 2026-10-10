import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { checkEligibility, describeIntervals, startAttempt } from '@/server/test';

export const dynamic = 'force-dynamic';

const Body = z.object({ specialization: z.enum(SPECIALIZATIONS), grade: z.enum(['junior', 'middle']) });

/** POST /api/test/start {specialization, grade} — новая попытка (201) или активная той же категории (200). R-C-05, R-C-06, R-C-09. */
export const POST = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const result = await startAttempt(candidateId, body.specialization, body.grade);
  return Response.json(result, { status: result.resumed ? 200 : 201 });
});

/** GET /api/test/start?specialization=&grade= — можно ли начать (интервалы R-C-09) и правила. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const url = new URL(req.url);
  const q = Body.parse({ specialization: url.searchParams.get('specialization'), grade: url.searchParams.get('grade') });
  const eligibility = await checkEligibility(candidateId, q.specialization, q.grade);
  return Response.json({ ...eligibility, rules: describeIntervals() });
});
