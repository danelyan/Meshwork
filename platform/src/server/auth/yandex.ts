import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getEnv } from '@/server/env';

import type { ExternalProfile } from './users';

/**
 * Вход через Яндекс ID: OAuth 2.0 authorization code + PKCE (S256) + state.
 * Доки: yandex.ru/dev/id/doc/ru/codes/code-url (authorize, token, PKCE S256),
 * yandex.ru/dev/id/doc/ru/user-information (login.yandex.ru/info, заголовок
 * `Authorization: OAuth <token>`). Токен Яндекса живёт только в памяти этого
 * запроса: получили профиль — забыли. Не логируем ни токен, ни code.
 */
export const YANDEX_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
export const YANDEX_TOKEN_URL = 'https://oauth.yandex.ru/token';
export const YANDEX_INFO_URL = 'https://login.yandex.ru/info?format=json';
export const YANDEX_SCOPES = 'login:info login:email';

export const OAUTH_COOKIE = 'yoauth';
export const OAUTH_TTL_SEC = 10 * 60;
const FETCH_TIMEOUT_MS = 10_000;

export interface YandexConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Конфиг или null, если вход через Яндекс на стенде не настроен. */
export function yandexConfig(): YandexConfig | null {
  const env = getEnv();
  if (!env.YANDEX_CLIENT_ID || !env.YANDEX_CLIENT_SECRET) return null;
  return {
    clientId: env.YANDEX_CLIENT_ID,
    clientSecret: env.YANDEX_CLIENT_SECRET,
    redirectUri: new URL('/api/auth/yandex/callback', env.APP_URL).toString(),
  };
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** PKCE S256 (RFC 7636 § 4.2): base64url(sha256(verifier)) без '='. */
export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export interface OAuthState {
  state: string;
  verifier: string;
  next: string | null;
  exp: number;
}

// Отдельный контекст подписи, чтобы токен этой куки нельзя было выдать за сессию.
const sign = (payload: string, secret: string) => createHmac('sha256', `oauth-state|${secret}`).update(payload).digest('base64url');

export function signOAuthState(s: OAuthState, secret: string = getEnv().SESSION_SECRET): string {
  const payload = b64url(Buffer.from(JSON.stringify(s)));
  return `${payload}.${sign(payload, secret)}`;
}

const StateShape = z.object({ state: z.string().min(16), verifier: z.string().min(43).max(128), next: z.string().nullable(), exp: z.number() });

export function verifyOAuthState(
  token: string | undefined | null,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
): OAuthState | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = StateShape.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.exp <= nowSec) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Сравнение state за постоянное время. */
export function stateMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeUrl(cfg: YandexConfig, state: string, verifier: string): string {
  const u = new URL(YANDEX_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', YANDEX_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', pkceChallenge(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export class YandexAuthError extends Error {
  constructor(readonly stage: 'exchange' | 'profile', message: string) {
    super(message);
    this.name = 'YandexAuthError';
  }
}

const TokenResponse = z.object({ access_token: z.string().min(1) });

/** Обмен кода на access_token. Ошибка — YandexAuthError без тела ответа (там может быть секрет). */
export async function exchangeCode(cfg: YandexConfig, code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: verifier,
  });
  let res: Response;
  try {
    res = await fetch(YANDEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new YandexAuthError('exchange', 'Яндекс ID недоступен');
  }
  const json: unknown = await res.json().catch(() => null);
  const parsed = TokenResponse.safeParse(json);
  if (!res.ok || !parsed.success) {
    const code = typeof json === 'object' && json && 'error' in json ? String((json as { error: unknown }).error) : `http_${res.status}`;
    throw new YandexAuthError('exchange', `token: ${code.slice(0, 64)}`);
  }
  return parsed.data.access_token;
}

const InfoResponse = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(64)),
  login: z.string().optional(),
  default_email: z.string().nullish(),
  emails: z.array(z.string()).nullish(),
  real_name: z.string().nullish(),
  display_name: z.string().nullish(),
});

const EmailShape = z.email();

/** Профиль пользователя Яндекса → ExternalProfile. Почты может не быть. */
export async function fetchProfile(accessToken: string): Promise<ExternalProfile> {
  let res: Response;
  try {
    res = await fetch(YANDEX_INFO_URL, {
      headers: { authorization: `OAuth ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new YandexAuthError('profile', 'Яндекс ID недоступен');
  }
  const parsed = InfoResponse.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success) throw new YandexAuthError('profile', `info: http_${res.status}`);
  const p = parsed.data;
  const rawEmail = p.default_email || p.emails?.[0] || null;
  const email = rawEmail && EmailShape.safeParse(rawEmail).success ? rawEmail.toLowerCase() : null;
  const name = (p.real_name || p.display_name || p.login || 'Пользователь Яндекса').trim().slice(0, 120);
  return { provider: 'yandex', providerAccountId: p.id, name, email };
}
