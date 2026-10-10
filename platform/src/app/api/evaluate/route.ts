import { assertSameOrigin } from '@/server/auth/csrf';
import { clientKey, hit, type RateRule } from '@/server/auth/rate-limit';
import { errors, withErrors } from '@/server/errors';
import { EVAL_LIMITS, EvalInputError, evaluate, readJsonLimited } from '@/server/validation/evaluate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Прогонов с одного адреса: вычисление ограничено лимитами входа, лимит частоты — от перебора. */
const EVAL_RATE: RateRule = { limit: 30, windowMs: 10 * 60_000 };

/**
 * POST /api/evaluate {vacancies, candidates, relevance, k?} — прогон нашего ранжирования и базовой линии на наборе
 * пользователя: P@k, nDCG@k, MRR по каждой вакансии и в среднем, топ с объяснениями. Вход не нужен (жюри),
 * ничего не сохраняется. Тело ≤ 1 МБ, ≤ 50 вакансий, ≤ 1000 кандидатов.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  if (!hit(`evaluate:${clientKey(req)}`, EVAL_RATE)) throw errors.rateLimited('Слишком много прогонов. Подождите несколько минут.');
  const body = await readJsonLimited(req, EVAL_LIMITS.bodyBytes);
  if (!body.ok) {
    if (body.tooLarge) throw errors.payloadTooLarge(`Набор больше ${EVAL_LIMITS.bodyBytes / 1024 / 1024} МБ`);
    throw errors.badRequest('Тело запроса - не JSON');
  }
  try {
    return Response.json(evaluate(body.value), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof EvalInputError) throw errors.badRequest(e.message);
    throw e;
  }
});
