import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';
import { SETTINGS, type SettingKey, type SettingValue, isSettingKey } from './registry';

export { SETTING_GROUPS, SETTINGS, SETTING_KEYS, isSettingKey, type SettingKey, type SettingValue } from './registry';

/**
 * Настройки платформы без деплоя (E-08, фаза 4): умолчание в коде, `PlatformSetting` перекрывает.
 *
 * Кэш: все перекрытия читаются одним запросом и живут SETTINGS_TTL_MS (≤ 30 с); запись сбрасывает кэш этого
 * процесса сразу, остальные процессы подхватят изменение не позже чем через TTL. Сбой чтения БД не валит
 * вызывающего (приглашения, тест): возвращается умолчание, в лог пишется предупреждение.
 */

export const SETTINGS_TTL_MS = 20_000;

type Actor = Pick<StaffContext, 'staffId' | 'ip'>;

let cache: { at: number; map: Map<string, unknown> } | null = null;
let inflight: Promise<Map<string, unknown>> | null = null;

export function resetSettingsCache(): void {
  cache = null;
  inflight = null;
}

async function loadOverrides(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < SETTINGS_TTL_MS) return cache.map;
  if (!inflight) {
    inflight = prisma.platformSetting
      .findMany({ select: { key: true, value: true } })
      .then((rows) => {
        const map = new Map(rows.map((r) => [r.key, r.value as unknown]));
        cache = { at: Date.now(), map };
        return map;
      })
      .catch((e: unknown) => {
        console.warn('[settings] не удалось прочитать PlatformSetting, используются умолчания:', e instanceof Error ? e.message : e);
        // Короткий кэш пустого набора: не долбим упавшую БД на каждом вызове.
        const map = new Map<string, unknown>();
        cache = { at: Date.now() - SETTINGS_TTL_MS + 3_000, map };
        return map;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function defaultSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].default() as SettingValue<K>;
}

/** Значение настройки: перекрытие из БД (если проходит схему), иначе умолчание из кода. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const raw = (await loadOverrides()).get(key);
  if (raw === undefined) return defaultSetting(key);
  const parsed = SETTINGS[key].schema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[settings] значение ${key} в БД не проходит схему, используется умолчание`);
    return defaultSetting(key);
  }
  return parsed.data as SettingValue<K>;
}

function parseValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const parsed = SETTINGS[key].schema.safeParse(value);
  if (!parsed.success) {
    throw errors.badRequest(`Значение не подходит: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'значение'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data as SettingValue<K>;
}

async function writeSetting(
  key: SettingKey,
  value: unknown,
  actor: Actor,
  reason: string,
  action: 'edit_settings' | 'edit_settings.rollback' | 'edit_catalogs.templates',
): Promise<void> {
  const next = parseValue(key, value);
  await prisma.$transaction(async (tx) => {
    const before = await tx.platformSetting.findUnique({ where: { key } });
    const json = next as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({
      where: { key },
      create: { key, value: json, updatedById: actor.staffId },
      update: { value: json, updatedById: actor.staffId },
    });
    await tx.platformSettingVersion.create({ data: { key, value: json, updatedById: actor.staffId, reason } });
    await audit(
      { actor, action, target: { type: 'setting', id: key }, reason, before: { value: before ? before.value : defaultSetting(key), isDefault: !before }, after: { value: next } },
      tx,
    );
  });
  resetSettingsCache();
}

/** Записать значение: валидация по схеме, причина обязательна, версия и журнал — в одной транзакции. */
export async function setSetting<K extends SettingKey>(key: K, value: unknown, actor: Actor, reason: string | null | undefined): Promise<void> {
  await writeSetting(key, value, actor, requireReason(reason), 'edit_settings');
}

/** Служебная запись для справочников (скрытые шаблоны): то же, что setSetting, но с другим действием журнала. */
export async function setCatalogSetting<K extends SettingKey>(key: K, value: unknown, actor: Actor, reason: string | null | undefined): Promise<void> {
  await writeSetting(key, value, actor, requireReason(reason), 'edit_catalogs.templates');
}

/** Откат на версию из истории: значение версии снова становится текущим (новая версия + журнал). */
export async function rollbackSetting(key: SettingKey, versionId: string, actor: Actor, reason: string | null | undefined): Promise<void> {
  const r = requireReason(reason);
  const version = await prisma.platformSettingVersion.findFirst({ where: { id: versionId, key } });
  if (!version) throw errors.notFound('Версия не найдена');
  await writeSetting(key, version.value, actor, r, 'edit_settings.rollback');
}

/** Вернуть умолчание из кода: записывается как обычное значение, остаётся в истории и откатывается. */
export async function resetSettingToDefault(key: SettingKey, actor: Actor, reason: string | null | undefined): Promise<void> {
  await writeSetting(key, defaultSetting(key), actor, requireReason(reason), 'edit_settings.rollback');
}

export interface SettingView {
  key: SettingKey;
  group: string;
  title: string;
  description: string;
  unit: string | null;
  internal: boolean;
  value: unknown;
  defaultValue: unknown;
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export async function listSettings(): Promise<SettingView[]> {
  const rows = await prisma.platformSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const staffIds = [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))];
  const staff = staffIds.length ? await prisma.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const out: SettingView[] = [];
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const d = SETTINGS[key];
    const row = byKey.get(key);
    const parsed = row ? d.schema.safeParse(row.value) : null;
    out.push({
      key,
      group: d.group,
      title: d.title,
      description: d.description,
      unit: d.unit ?? null,
      internal: d.internal ?? false,
      value: parsed?.success ? parsed.data : defaultSetting(key),
      defaultValue: defaultSetting(key),
      overridden: Boolean(parsed?.success),
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedById ? { id: row.updatedById, name: names.get(row.updatedById) ?? row.updatedById } : null,
    });
  }
  return out;
}

export interface SettingVersionView {
  id: string;
  value: unknown;
  reason: string | null;
  createdAt: string;
  updatedBy: { id: string; name: string } | null;
}

export async function listSettingVersions(key: string, take = 50): Promise<SettingVersionView[]> {
  if (!isSettingKey(key)) throw errors.notFound('Настройка не найдена');
  const rows = await prisma.platformSettingVersion.findMany({ where: { key }, orderBy: { createdAt: 'desc' }, take });
  const ids = [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))];
  const staff = ids.length ? await prisma.staffMember.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    value: r.value,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    updatedBy: r.updatedById ? { id: r.updatedById, name: names.get(r.updatedById) ?? r.updatedById } : null,
  }));
}
