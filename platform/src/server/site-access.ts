import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { hostnameOf } from '@/server/devtools/guard';

/**
 * Закрытый стенд: при заданном пароле публичный адрес пускает только после его ввода (без логина).
 * Пароль задаётся SITE_PASSWORD или его SHA-256 в SITE_PASSWORD_SHA256 (хеш можно держать в конфиге
 * репозитория, сам пароль — нет). localhost / 127.0.0.1 / [::1] не закрываются. Проверка — src/middleware.ts.
 */
export const SITE_ACCESS_COOKIE = 'site_access';
export const SITE_ACCESS_PATH = '/site-access';
export const SITE_ACCESS_MAX_AGE = 30 * 24 * 60 * 60;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Пути без пароля: проверка живости для CI и healthcheck контейнера, сама страница пароля. */
const OPEN_PATHS = new Set(['/api/health', SITE_ACCESS_PATH]);

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Ключ гейта — SHA-256 пароля в hex; undefined — стенд открыт. */
export function siteAccessKey(env: { SITE_PASSWORD?: string; SITE_PASSWORD_SHA256?: string }): string | undefined {
  if (env.SITE_PASSWORD_SHA256) return env.SITE_PASSWORD_SHA256.toLowerCase();
  if (env.SITE_PASSWORD) return sha256(env.SITE_PASSWORD).toString('hex');
  return undefined;
}

/**
 * Значение куки: HMAC серверного секрета по ключу. Хеш пароля может лежать в репозитории, поэтому без
 * секрета куку не подделать; смена пароля или секрета разлогинивает всех.
 */
export function siteAccessToken(key: string, secret: string): string {
  return createHmac('sha256', secret).update(`fsp-site-access-v2:${key}`).digest('base64url');
}

/** Сравнение за постоянное время: SHA-256 ввода против ключа. */
export function passwordMatches(input: string, key: string): boolean {
  const expected = Buffer.from(key, 'hex');
  const actual = sha256(input);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function sameString(a: string, b: string): boolean {
  const x = sha256(a);
  const y = sha256(b);
  return timingSafeEqual(x, y);
}

export type SiteAccessDecision = 'allow' | 'redirect' | 'deny';

/** Чистое решение гейта: deny — для /api/* (401 JSON), redirect — страницы ведут на ввод пароля. */
export function siteAccessDecision(input: {
  key: string | undefined;
  secret: string;
  host: string | null;
  pathname: string;
  cookie: string | undefined;
}): SiteAccessDecision {
  if (!input.key) return 'allow';
  const name = hostnameOf(input.host);
  if (name !== null && LOCAL_HOSTNAMES.has(name)) return 'allow';
  if (OPEN_PATHS.has(input.pathname)) return 'allow';
  if (input.cookie && sameString(input.cookie, siteAccessToken(input.key, input.secret))) return 'allow';
  return input.pathname.startsWith('/api/') ? 'deny' : 'redirect';
}
