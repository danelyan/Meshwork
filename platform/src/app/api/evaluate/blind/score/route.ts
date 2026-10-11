import { z } from 'zod';

import { assertSameOrigin } from '@/server/auth/csrf';
import { getEnv } from '@/server/env';
import { errors, withErrors } from '@/server/errors';
import { BlindTokenError, scoreBlind, verifyBlindToken } from '@/server/validation/blind';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  token: z.string().min(1).max(8192),
  ratings: z.record(z.string().regex(/^c\d{1,2}$/), z.number().int().min(0).max(3)),
});

/** POST /api/evaluate/blind/score {token, ratings} – чей порядок лучше по оценкам жюри: meanRating, P@3 (оценка ≥ 2), nDCG@3. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { token, ratings } = Body.parse(await req.json().catch(() => null));
  try {
    const payload = verifyBlindToken(token, getEnv().SESSION_SECRET);
    return Response.json(scoreBlind(payload.cards, ratings), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof BlindTokenError) throw errors.badRequest(e.message);
    throw e;
  }
});
