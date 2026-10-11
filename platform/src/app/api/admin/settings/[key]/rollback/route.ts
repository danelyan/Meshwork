import { z } from 'zod';

import { requireStaff } from '@/server/admin/session';
import { getSetting, isSettingKey, resetSettingToDefault, rollbackSetting } from '@/server/admin/settings';
import { errors, withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.union([z.object({ versionId: z.string().min(1), reason: z.string() }), z.object({ toDefault: z.literal(true), reason: z.string() })]);

/** POST { versionId, reason } - откат на версию из истории; { toDefault: true, reason } - вернуть умолчание из кода (edit_settings). */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ key: string }> }) => {
  const staff = await requireStaff(req, 'edit_settings');
  const { key } = await ctx.params;
  if (!isSettingKey(key)) throw errors.notFound('Настройка не найдена');
  const body = Body.parse(await req.json().catch(() => ({})));
  if ('versionId' in body) await rollbackSetting(key, body.versionId, staff, body.reason);
  else await resetSettingToDefault(key, staff, body.reason);
  return Response.json({ key, value: await getSetting(key) });
});
