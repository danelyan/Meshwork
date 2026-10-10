import { createHash } from 'node:crypto';

/**
 * Версия пароля для куки: 8 символов base64url от sha256(passwordHash). Хэш пароля солёный,
 * поэтому каждая смена пароля даёт новую версию. Нет пароля → пустая строка.
 * Отдельный модуль без `server-only`: его берёт `auth/users.ts`, а тот — консольные прогоны
 * `npx tsx eval/...` вне Next.js, где `server-only` не подключить (пакета в зависимостях нет).
 */
export function passwordVersionOf(passwordHash: string | null | undefined): string {
  return passwordHash ? createHash('sha256').update(passwordHash).digest('base64url').slice(0, 8) : '';
}
