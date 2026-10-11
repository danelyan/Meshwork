import { headers } from 'next/headers';

import { devtoolsEnabled, getEnv } from '@/server/env';
import { errors } from '@/server/errors';

/** Хосты, на которых дебаг-панель разрешена (порт любой). */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Имя хоста из заголовка Host: без порта, в нижнем регистре; IPv6 остаётся в скобках. */
export function hostnameOf(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? null : h.slice(0, end + 1);
  }
  return h.split(':')[0] || null;
}

/**
 * Проверка без обращения к запросу: окружение и значение Host. Выключатель DEVTOOLS берётся из проверенного
 * окружения (`getEnv()`, схема в env.ts); явный `env` – сырые значения для тестов, разбор тот же.
 * NODE_ENV читается напрямую: в production выходим раньше, не обращаясь к схеме окружения.
 */
export function isDevHostFor(host: string | null | undefined, env?: Record<string, string | undefined>): boolean {
  if ((env ?? process.env).NODE_ENV === 'production') return false;
  const enabled = env ? devtoolsEnabled(env.DEVTOOLS) : getEnv().DEVTOOLS !== false;
  if (!enabled) return false;
  const name = hostnameOf(host);
  return name !== null && LOCAL_HOSTNAMES.has(name);
}

/**
 * Дебаг-инструменты (панель и /api/dev/*) только на localhost: не production, Host – localhost / 127.0.0.1 / [::1],
 * выключатель env DEVTOOLS=false. Для server components (Next 15: `headers()` асинхронная).
 * На проде возвращается до `headers()`, чтобы не переводить страницы в динамические.
 */
export async function isDevHost(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') return false;
  return isDevHostFor((await headers()).get('host'));
}

/** Для route handler'ов: Host запроса (если заголовка нет, например в тестах, - хост из URL). */
export function isDevRequest(req: Request): boolean {
  return isDevHostFor(req.headers.get('host') ?? new URL(req.url).host);
}

/** Не localhost или production → 404 (маршрут как будто не существует). */
export function assertDevRequest(req: Request): void {
  if (!isDevRequest(req)) throw errors.notFound();
}
