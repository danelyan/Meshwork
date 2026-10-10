import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { pkceChallenge, randomToken } from '@/server/auth/yandex';
import { getEnv } from '@/server/env';

import { IdTokenInvalid, verifyIdToken, type IdTokenClaims, type Jwks } from './jwt';
import { mockTransport } from './mock/provider';

/**
 * Наш клиент (relying party) ФСП ID по OIDC: Authorization Code + PKCE S256, state, nonce.
 * Провайдер задаётся env (FSP_OIDC_ISSUER …): сейчас — симулятор ФСП ID команды на Keycloak, в проде —
 * реалм Keycloak ФСП. Без env привязка выключена, ФСП остаётся демо-источником (R-FSP-03 не меняется).
 * Транспорт к провайдеру отделён (`FspIdTransport`): в тестах — мок в процессе, на стенде — HTTP.
 */

export const FSP_OAUTH_COOKIE = 'fspoidc';
export const FSP_OAUTH_COOKIE_PATH = '/api/fsp-id';
export const FSP_OAUTH_TTL_SEC = 10 * 60;
export const FSP_CALLBACK_PATH = '/api/fsp-id/callback';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface FspIdTransport {
  issuer: string;
  clientId: string;
  redirectUri: string;
  authorizationEndpoint(): Promise<string>;
  token(form: URLSearchParams): Promise<{ status: number; body: unknown }>;
  /** `refresh` — перечитать JWKS мимо кэша (ротация ключа: kid не найден). */
  jwks(opts?: { refresh?: boolean }): Promise<Jwks>;
}

export interface FspOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  apiUrl: string | null;
  redirectUri: string;
}

/**
 * Конфиг внешнего провайдера из env или null. Нужны и issuer, и секрет: клиент `fsp-career` у симулятора
 * команды конфиденциальный (без секрета token endpoint отвечает 401 unauthorized_client, проверено 11.10).
 */
export function fspOidcConfig(): FspOidcConfig | null {
  const env = getEnv();
  if (!env.FSP_OIDC_ISSUER || !env.FSP_OIDC_CLIENT_SECRET) return null;
  return {
    issuer: env.FSP_OIDC_ISSUER.replace(/\/+$/, ''),
    clientId: env.FSP_OIDC_CLIENT_ID ?? 'fsp-career',
    clientSecret: env.FSP_OIDC_CLIENT_SECRET ?? null,
    apiUrl: env.FSP_API_URL ? env.FSP_API_URL.replace(/\/+$/, '') : null,
    redirectUri: new URL(FSP_CALLBACK_PATH, env.APP_URL).toString(),
  };
}

/** Внешний провайдер (симулятор ФСП ID на Keycloak) или встроенный мок — если внешний не настроен. */
export type FspProviderMode = 'external' | 'mock';

export function fspProviderMode(): FspProviderMode {
  return fspOidcConfig() ? 'external' : 'mock';
}

/** Транспорт для маршрутов привязки: внешний по env, иначе мок в процессе (`/api/fsp-id/realms/fsp`). */
export function fspTransport(): FspIdTransport {
  const cfg = fspOidcConfig();
  return cfg ? httpTransport(cfg) : mockTransport();
}

/** Сбой связи с провайдером (discovery, token, JWKS): сеть, таймаут, не-200, кривой ответ. */
export class FspProviderUnavailable extends Error {
  constructor(readonly stage: 'discovery' | 'token' | 'jwks') {
    super(`fsp-id provider unavailable: ${stage}`);
    this.name = 'FspProviderUnavailable';
  }
}

const Discovery = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
type DiscoveryDoc = z.infer<typeof Discovery>;
const JwksShape = z.object({ keys: z.array(z.object({ kty: z.string(), kid: z.string().optional() }).passthrough()) });

const discoveryCache = new Map<string, { doc: DiscoveryDoc; exp: number }>();
const jwksCache = new Map<string, { set: Jwks; exp: number }>();

/** Только для тестов. */
export function resetFspOidcCache(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

async function getJson(url: string, stage: FspProviderUnavailable['stage']): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new FspProviderUnavailable(stage);
  }
  if (!res.ok) throw new FspProviderUnavailable(stage);
  return res.json().catch(() => {
    throw new FspProviderUnavailable(stage);
  });
}

/**
 * Discovery по issuer (OIDC Discovery 1.0): `<issuer>/.well-known/openid-configuration`, кэш 10 минут.
 * `issuer` в ответе обязан совпасть с настроенным (§ 4.3), иначе провайдер считается недоступным.
 */
async function discover(issuer: string): Promise<DiscoveryDoc> {
  const hit = discoveryCache.get(issuer);
  if (hit && hit.exp > Date.now()) return hit.doc;
  const parsed = Discovery.safeParse(await getJson(`${issuer}/.well-known/openid-configuration`, 'discovery'));
  if (!parsed.success || parsed.data.issuer.replace(/\/+$/, '') !== issuer) throw new FspProviderUnavailable('discovery');
  discoveryCache.set(issuer, { doc: parsed.data, exp: Date.now() + CACHE_TTL_MS });
  return parsed.data;
}

/** HTTP-транспорт к настоящему провайдеру (Keycloak). Секрет клиента — только в теле запроса токена. */
export function httpTransport(cfg: FspOidcConfig): FspIdTransport {
  return {
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    authorizationEndpoint: async () => (await discover(cfg.issuer)).authorization_endpoint,
    async token(form) {
      const d = await discover(cfg.issuer);
      const body = new URLSearchParams(form);
      if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
      let res: Response;
      try {
        res = await fetch(d.token_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch {
        throw new FspProviderUnavailable('token');
      }
      if (res.status >= 500) throw new FspProviderUnavailable('token');
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    async jwks(opts = {}) {
      const d = await discover(cfg.issuer);
      const hit = jwksCache.get(d.jwks_uri);
      if (!opts.refresh && hit && hit.exp > Date.now()) return hit.set;
      const parsed = JwksShape.safeParse(await getJson(d.jwks_uri, 'jwks'));
      if (!parsed.success) throw new FspProviderUnavailable('jwks');
      const set = parsed.data as unknown as Jwks;
      jwksCache.set(d.jwks_uri, { set, exp: Date.now() + CACHE_TTL_MS });
      return set;
    },
  };
}

export interface FspFlowState {
  state: string;
  nonce: string;
  verifier: string;
  /** Чей поток: callback сверяет с кандидатом текущей сессии. Пусто — вход на платформу (`mode: login`). */
  candidateId: string;
  /** Куда вернуть: настройки или чат знакомства (шаг ФСП). */
  ret?: FspReturn;
  /** `link` — привязка к вошедшему кандидату; `login` — вход на платформу через ФСП ID (/auth). */
  mode?: 'link' | 'login';
  /** Вход: версия согласия с галки на /auth и куда вести после входа. */
  consent?: string;
  next?: string | null;
  exp: number;
}

export type FspReturn = 'settings' | 'consultant';
export const FSP_RETURN_PATH: Record<FspReturn, string> = { settings: '/settings', consultant: '/consultant' };

const sign = (payload: string, secret: string) => createHmac('sha256', `fsp-oidc-state|${secret}`).update(payload).digest('base64url');

export function signFlowState(s: FspFlowState, secret: string = getEnv().SESSION_SECRET): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

const FlowShape = z.object({
  state: z.string().min(16).max(256),
  nonce: z.string().min(16).max(256),
  verifier: z.string().min(43).max(128),
  candidateId: z.string().max(64),
  ret: z.enum(['settings', 'consultant']).optional(),
  mode: z.enum(['link', 'login']).optional(),
  consent: z.string().max(64).optional(),
  next: z.string().max(512).nullish(),
  exp: z.number(),
});

export function verifyFlowState(
  token: string | undefined | null,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
): FspFlowState | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = FlowShape.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.exp <= nowSec) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Новый поток: state, nonce и PKCE verifier (64 символа base64url, RFC 7636: 43..128). */
export function newFlow(candidateId: string, nowSec = Math.floor(Date.now() / 1000), ret: FspReturn = 'settings'): FspFlowState {
  return { state: randomToken(24), nonce: randomToken(24), verifier: randomToken(48), candidateId, ret, mode: 'link', exp: nowSec + FSP_OAUTH_TTL_SEC };
}

/** Поток входа на платформу через ФСП ID: без кандидата, с согласием и адресом возврата. */
export function newLoginFlow(consent: string, next: string | null, nowSec = Math.floor(Date.now() / 1000)): FspFlowState {
  return { state: randomToken(24), nonce: randomToken(24), verifier: randomToken(48), candidateId: '', mode: 'login', consent, next, exp: nowSec + FSP_OAUTH_TTL_SEC };
}

export async function buildAuthorizeUrl(t: FspIdTransport, flow: FspFlowState): Promise<string> {
  const u = new URL(await t.authorizationEndpoint());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', t.clientId);
  u.searchParams.set('redirect_uri', t.redirectUri);
  u.searchParams.set('scope', 'openid profile');
  u.searchParams.set('state', flow.state);
  u.searchParams.set('nonce', flow.nonce);
  u.searchParams.set('code_challenge', pkceChallenge(flow.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/** Код ошибки возврата — уходит в `/settings?fsp=<код>`; ни токенов, ни кода авторизации в URL. */
export type FspCallbackError = 'denied' | 'state' | 'session' | 'exchange' | 'token' | 'unavailable';

export class FspCallbackFailed extends Error {
  constructor(readonly code: FspCallbackError, readonly detail?: string) {
    super(`fsp-id callback: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'FspCallbackFailed';
  }
}

function stateEq(a: string, b: string | null): boolean {
  if (!b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const TokenBody = z.object({ id_token: z.string().min(10).max(16384), access_token: z.string().min(1).max(16384), token_type: z.string().regex(/^bearer$/i) });

export interface FspFlowResult {
  claims: IdTokenClaims;
  /** Токен пользователя для API реестра (/me/achievements); живёт только в памяти запроса. */
  accessToken: string;
}

/**
 * Возврат от провайдера: state из подписанной куки, кандидат сессии = кандидат потока, обмен кода
 * с PKCE verifier, проверка ID-токена (подпись RS256 по JWKS провайдера, iss, aud, exp, nonce).
 */
export async function completeFlow(
  t: FspIdTransport,
  params: URLSearchParams,
  saved: FspFlowState | null,
  /** Кандидат сессии для привязки; `null` — поток входа (`mode: login`), кандидата ещё нет. */
  candidateId: string | null,
  opts: { nowSec?: number } = {},
): Promise<FspFlowResult> {
  if (params.get('error')) throw new FspCallbackFailed('denied', params.get('error')!.slice(0, 64));
  if (!saved || !stateEq(saved.state, params.get('state'))) throw new FspCallbackFailed('state');
  const login = saved.mode === 'login';
  if (login !== (candidateId === null) || (!login && saved.candidateId !== candidateId)) throw new FspCallbackFailed('session');
  const code = params.get('code');
  if (!code || code.length > 2048) throw new FspCallbackFailed('exchange', 'no_code');

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: t.clientId,
    redirect_uri: t.redirectUri,
    code_verifier: saved.verifier,
  });
  try {
    const res = await t.token(form);
    const parsed = TokenBody.safeParse(res.body);
    if (res.status !== 200 || !parsed.success) {
      const err = typeof res.body === 'object' && res.body && 'error' in res.body ? String((res.body as { error: unknown }).error) : `http_${res.status}`;
      throw new FspCallbackFailed('exchange', err.slice(0, 64));
    }
    const verify = (set: Jwks) => verifyIdToken(parsed.data.id_token, set, { issuer: t.issuer, clientId: t.clientId, nonce: saved.nonce, nowSec: opts.nowSec });
    let claims: IdTokenClaims;
    try {
      claims = verify(await t.jwks());
    } catch (err) {
      // Ротация ключа у провайдера: kid не найден в кэше — перечитываем JWKS один раз.
      if (!(err instanceof IdTokenInvalid && err.reason === 'kid')) throw err;
      claims = verify(await t.jwks({ refresh: true }));
    }
    return { claims, accessToken: parsed.data.access_token };
  } catch (err) {
    if (err instanceof FspCallbackFailed) throw err;
    if (err instanceof IdTokenInvalid) throw new FspCallbackFailed('token', err.reason);
    if (err instanceof FspProviderUnavailable) throw new FspCallbackFailed('unavailable', err.stage);
    throw new FspCallbackFailed('exchange', 'unknown');
  }
}

/**
 * Идентификатор участника ФСП из claims: `fsp_id` (claim симулятора и предполагаемого реалма ФСП),
 * иначе `sub`. Регион и роли — для отображения, на подбор не влияют.
 */
export function fspIdentity(claims: IdTokenClaims): { fspId: string; name: string | null; region: string | null } {
  const raw = claims.fsp_id;
  const fspId = (typeof raw === 'string' || typeof raw === 'number') && String(raw).length > 0 && String(raw).length <= 128 ? String(raw) : claims.sub;
  const name = [claims.name, claims.preferred_username].find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? null;
  const region = typeof claims.region_code === 'string' || typeof claims.region_code === 'number' ? String(claims.region_code).slice(0, 16) : null;
  return { fspId, name: name ? name.trim().slice(0, 120) : null, region };
}
