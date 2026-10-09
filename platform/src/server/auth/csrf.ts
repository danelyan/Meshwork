import { getEnv } from '@/server/env';
import { errors } from '@/server/errors';

/**
 * Защита POST от CSRF поверх SameSite=Lax: если браузер прислал Origin, он должен
 * совпадать с APP_URL или с адресом самого запроса. Нет Origin (curl, тесты) — пропускаем:
 * кука с SameSite=Lax на межсайтовый POST всё равно не уходит.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const allowed = new Set([new URL(getEnv().APP_URL).origin, new URL(req.url).origin]);
  if (!allowed.has(origin)) throw errors.forbidden('Запрос с чужого сайта');
}
