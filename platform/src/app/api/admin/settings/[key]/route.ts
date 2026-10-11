import { z } from 'zod';

import { requireStaff } from '@/server/admin/session';
import { defaultSetting, getSetting, isSettingKey, listSettingVersions, setSetting } from '@/server/admin/settings';
import { errors, withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ value: z.unknown(), reason: z.string() });

type Ctx = { params: Promise<{ key: string }> };

async function keyOf(ctx: Ctx) {
  const { key } = await ctx.params;
  if (!isSettingKey(key)) throw errors.notFound('Настройка не найдена');
  return key;
}

/** Значение, умолчание и история версий (view_settings). */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  await requireStaff(req, 'view_settings');
  const key = await keyOf(ctx);
  return Response.json({ key, value: await getSetting(key), defaultValue: defaultSetting(key), versions: await listSettingVersions(key) });
});

/** PUT { value, reason } - записать значение (edit_settings). Причина обязательна, версия и журнал - в одной транзакции. */
export const PUT = withErrors(async (req: Request, ctx: Ctx) => {
  const staff = await requireStaff(req, 'edit_settings');
  const key = await keyOf(ctx);
  const body = Body.parse(await req.json().catch(() => ({})));
  await setSetting(key, body.value, staff, body.reason);
  return Response.json({ key, value: await getSetting(key) });
});
