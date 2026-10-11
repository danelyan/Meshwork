import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { getEnv } from '@/server/env';
import { recordSignals } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Тело – несколько счётчиков; больше – мусор. */
const MAX_BODY_CHARS = 2048;
const count = (max: number) => z.number().int().min(0).max(max).default(0);

/** Дельты с прошлой отправки. Только агрегаты: содержимое вставок и копий не передаётся (152-ФЗ). */
const Body = z.object({
  tabHidden: count(100),
  hiddenMs: count(24 * 60 * 60 * 1000),
  pastes: count(100),
  pasteChars: count(100_000),
  copies: count(100),
  extendedScreen: z.boolean().optional(),
});

/**
 * POST /api/test/attempt/[id]/signal {tabHidden, hiddenMs, pastes, pasteChars, copies, extendedScreen?} – дельты сигналов
 * браузера к активной попытке своего кандидата; сервер суммирует в TestAttempt.signals (индекс честности, ADR-0002 11.10).
 * Тело читается текстом и разбирается как JSON: так принимается и navigator.sendBeacon (Content-Type text/plain).
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) throw errors.notFound('Попытка не найдена');
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw errors.badRequest('Слишком большое тело запроса');
  let raw: unknown = {};
  try {
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw errors.badRequest('Тело должно быть JSON');
  }
  const body = Body.parse(raw);
  const signals = await recordSignals(candidateId, id, body);
  // Счётчики наружу только слою жюри: иначе кандидат видел бы, что именно считается.
  return Response.json(getEnv().JURY_INSIGHTS ? { signals } : { ok: true });
});
