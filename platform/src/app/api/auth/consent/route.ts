import { z } from 'zod';

import { CONSENT_VERSION, recordConsent } from '@/server/auth/consent';
import { assertSameOrigin } from '@/server/auth/csrf';
import { withErrors } from '@/server/errors';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ version: z.string().min(1).max(64) });

/** Текущая версия текста согласия (docs/consent.md). */
export const GET = () => Response.json({ version: CONSENT_VERSION });

/** Зафиксировать согласие на обработку ПДн (R-C-14). Устаревшая версия → 409. */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const { userId } = requireUser(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const consent = await recordConsent(userId, body.version);
  return Response.json({ version: consent.version, acceptedAt: consent.acceptedAt });
});
