import { createHash } from 'node:crypto';

/**
 * Версия пароля для куки: 8 символов base64url от sha256(passwordHash). Хэш пароля солёный,
 * поэтому каждая смена пароля даёт новую версию. Нет пароля → пустая строка.
 * Отдельный модуль без `server-only`: его берёт `auth/users.ts`, а тот – консольные прогоны
 * `npx tsx eval/...` вне Next.js, где `server-only` не подключить (пакета в зависимостях нет).
 */
export function passwordVersionOf(passwordHash: string | null | undefined): string {
  return passwordHash ? createHash('sha256').update(passwordHash).digest('base64url').slice(0, 8) : '';
}

/**
 * Версия сессии аккаунта (E-08, фаза 3): версия пароля плюс отметка последней блокировки. Блокировка ставит
 * новый `blockedAt` – версия меняется, и все ранее выданные куки `cid` протухают (`sessionExists`), в том числе
 * у аккаунтов без пароля (Яндекс, демо): им кука выдаётся уже с версией. Разблокировка `blockedAt` не стирает
 * (ставит `blockedUntil`), поэтому куки, выданные до блокировки, не оживают. Без блокировки – ровно
 * `passwordVersionOf`: выданные ранее куки остаются действительными.
 */
export function sessionVersionOf(user: { passwordHash: string | null | undefined; blockedAt?: Date | null }): string {
  if (!user.blockedAt) return passwordVersionOf(user.passwordHash);
  return createHash('sha256').update(`${user.passwordHash ?? ''}|blocked:${user.blockedAt.toISOString()}`).digest('base64url').slice(0, 8);
}
