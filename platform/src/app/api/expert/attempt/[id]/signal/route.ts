import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { assertExpertEnabled, requireExpert } from '@/server/expert';
import { recordSignals } from '@/server/test';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_CHARS = 2048;
const count = (max: number) => z.number().int().min(0).max(max).default(0);

/** Те же дельты, что у кандидата (/api/test/attempt/[id]/signal): только агрегаты. */
const Body = z.object({
  tabHidden: count(100),
  hiddenMs: count(24 * 60 * 60 * 1000),
  pastes: count(100),
  pasteChars: count(100_000),
  copies: count(100),
  extendedScreen: z.boolean().optional(),
});

/** POST /api/expert/attempt/[id]/signal – сигналы браузера к активной попытке эксперта (индекс честности). Тело – JSON текстом (sendBeacon). */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  assertExpertEnabled();
  const candidateId = await requireExpert(req);
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
  return Response.json({ signals: await recordSignals(candidateId, id, Body.parse(raw)) });
});
