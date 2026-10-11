import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { clientKey, hit, type RateRule } from '@/server/auth/rate-limit';
import { getEnv } from '@/server/env';
import { errors, withErrors } from '@/server/errors';
import { startBlind } from '@/server/validation/blind-load';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const START_RATE: RateRule = { limit: 30, windowMs: 10 * 60_000 };
const Body = z.object({ vacancyId: z.string().min(1).max(64) });

/**
 * POST /api/evaluate/blind/start {vacancyId} – 8 анонимных карточек вслепую (наш топ-3, BM25 топ-3, случайные),
 * перемешаны; источник каждой – в подписанном токене (1 час). Ничего не сохраняется.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  if (!hit(`evaluate-blind:${clientKey(req)}`, START_RATE)) throw errors.rateLimited('Слишком много разметок. Подождите несколько минут.');
  const { vacancyId } = Body.parse(await req.json().catch(() => null));
  return Response.json(await startBlind(vacancyId, getEnv().SESSION_SECRET), { headers: { 'cache-control': 'no-store' } });
});
