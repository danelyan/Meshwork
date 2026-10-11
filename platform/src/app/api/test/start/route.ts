import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { checkEligibility, describeIntervals, describeRetake, intervals, startAttempt } from '@/server/test';
import { GRADES } from '@/lib/grades';

export const dynamic = 'force-dynamic';

const Body = z.object({
  specialization: z.enum(SPECIALIZATIONS),
  grade: z.enum(GRADES),
  /** Подкатегория теста (Subcategory.id); не передана — из профиля кандидата. Тест идёт по подкатегории. */
  subcategoryId: z.string().max(64).nullish(),
});

/**
 * POST /api/test/start {specialization, grade, subcategoryId?} — новая попытка (201) или активная той же категории (200).
 * Без подкатегории направления — 422 subcategory_required; подкатегория без банка заданий — 422 no_test. R-C-05, R-C-06, R-C-09.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const result = await startAttempt(candidateId, body.specialization, body.grade, new Date(), { subcategoryId: body.subcategoryId ?? undefined });
  return Response.json(result, { status: result.resumed ? 200 : 201 });
});

/** GET /api/test/start?specialization=&grade=&subcategoryId= — можно ли начать (подкатегория, банк, интервалы R-C-09) и правила. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const url = new URL(req.url);
  const q = Body.parse({ specialization: url.searchParams.get('specialization'), grade: url.searchParams.get('grade'), subcategoryId: url.searchParams.get('subcategoryId') });
  const eligibility = await checkEligibility(candidateId, q.specialization, q.grade, new Date(), q.subcategoryId ?? undefined);
  const iv = await intervals();
  return Response.json({ ...eligibility, rules: describeIntervals(iv), retakeAfter: describeRetake(iv) });
});
