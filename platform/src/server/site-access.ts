import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { hostnameOf } from '@/server/devtools/guard';

/**
 * Закрытый стенд: при заданном SITE_PASSWORD публичный адрес пускает только после ввода пароля
 * (без логина). localhost / 127.0.0.1 / [::1] не закрываются. Проверка — в src/middleware.ts.
 */
export const SITE_ACCESS_COOKIE = 'site_access';
export const SITE_ACCESS_PATH = '/site-access';
export const SITE_ACCESS_MAX_AGE = 30 * 24 * 60 * 60;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Пути без пароля: проверка живости для CI и healthcheck контейнера, сама страница пароля. */
const OPEN_PATHS = new Set(['/api/health', SITE_ACCESS_PATH]);

/** Значение куки: производное от пароля, смена пароля разлогинивает всех. Сам пароль в куку не попадает. */
export function siteAccessToken(password: string): string {
  return createHmac('sha256', password).update('fsp-site-access-v1').digest('base64url');
}

/** Сравнение за постоянное время: дайджесты одинаковой длины при любой длине ввода. */
export function passwordMatches(input: string, password: string): boolean {
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(password).digest();
  return timingSafeEqual(a, b);
}

export type SiteAccessDecision = 'allow' | 'redirect' | 'deny';

/** Чистое решение гейта: deny — для /api/* (401 JSON), redirect — страницы ведут на ввод пароля. */
export function siteAccessDecision(input: {
  password: string | undefined;
  host: string | null;
  pathname: string;
  cookie: string | undefined;
}): SiteAccessDecision {
  if (!input.password) return 'allow';
  const name = hostnameOf(input.host);
  if (name !== null && LOCAL_HOSTNAMES.has(name)) return 'allow';
  if (OPEN_PATHS.has(input.pathname)) return 'allow';
  if (input.cookie && passwordMatches(input.cookie, siteAccessToken(input.password))) return 'allow';
  return input.pathname.startsWith('/api/') ? 'deny' : 'redirect';
}
