import { z } from 'zod';

import { clearOnboarding } from '@/server/devtools/actions';
import { devRoute, requireDevSession } from '@/server/devtools/route';

export const dynamic = 'force-dynamic';

const Body = z.object({ alsoProfile: z.boolean().default(false) });

/** Очистить онбординг (и по флагу ответы профиля). Только localhost. */
export const POST = devRoute(async (req) => {
  const s = requireDevSession(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  await clearOnboarding(s, body.alsoProfile);
  return Response.json({ ok: true, next: '/onboarding' });
});
