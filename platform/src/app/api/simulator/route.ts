import { assertSameOrigin } from '@/server/auth/csrf';
import { clientKey, hit, type RateRule } from '@/server/auth/rate-limit';
import { errors, withErrors } from '@/server/errors';
import { readJsonLimited } from '@/server/validation/evaluate';
import { SIM_LIMITS, SimInputError, simulate } from '@/server/validation/simulator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Прогон дешёвый (≤ 14 шагов по сетке из 81 узла), лимит частоты – от перебора. */
const SIM_RATE: RateRule = { limit: 120, windowMs: 10 * 60_000 };

/**
 * POST /api/simulator {subcategoryId, claimed, theta, mode?, seed?} - виртуальный кандидат проходит боевой движок
 * адаптивного теста: шаги, оценка θ и SE после каждого, итог. Детерминированно по seed, без БД и LLM, вход не нужен.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  if (!hit(`simulator:${clientKey(req)}`, SIM_RATE)) throw errors.rateLimited('Слишком много прогонов. Подождите несколько минут.');
  const body = await readJsonLimited(req, SIM_LIMITS.bodyBytes);
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge(`Запрос больше ${SIM_LIMITS.bodyBytes} байт`);
    throw errors.badRequest('Тело запроса - не JSON');
  }
  try {
    return Response.json(simulate(body.value), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof SimInputError) throw errors.badRequest(e.message);
    throw e;
  }
});
