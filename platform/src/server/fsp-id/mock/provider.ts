import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { fspDemoParticipant, type FspDemoParticipant } from '@/server/collector/fsp-demo';
import { getEnv } from '@/server/env';

import type { FspIdTransport } from '../client';
import { generateSigningKey, signJwt, type Jwks, type SigningKey } from '../jwt';

/**
 * МОК провайдера ФСП ID. Работает, пока внешний симулятор ФСП ID команды (Keycloak) не настроен в env:
 * у клиента `fsp-career` там конфиденциальный доступ, а секрета у нас нет (11.10). Страница входа –
 * `app/api/fsp-id/realms/fsp/protocol/openid-connect/auth`, обмен кода и JWKS – в процессе
 * (`mockTransport`), тот же клиент проверяет подпись и claims, что и для внешнего. Пути и форма ответов –
 * как у Keycloak (`/realms/<realm>/protocol/openid-connect/...`), чтобы в проде клиент переключился
 * на настоящий реалм сменой issuer. Поток – Authorization Code + PKCE S256, публичный клиент.
 *
 * Состояние (ключ подписи, коды, access-токены) – в памяти процесса на `globalThis`: один контейнер
 * приложения; после перезапуска ключ новый, недоиспользованные коды теряются – это мок. Приватный
 * ключ генерируется при первом обращении и никуда не пишется.
 */

export const FSP_ID_REALM_PATH = '/api/fsp-id/realms/fsp';
export const FSP_ID_CLIENT_ID = 'fsp-career';
export const FSP_ID_CALLBACK_PATH = '/api/fsp-id/callback';
const CODE_TTL_SEC = 60;
const TOKEN_TTL_SEC = 300;
const MAX_ENTRIES = 5000;

export function fspIssuer(appUrl: string = getEnv().APP_URL): string {
  return new URL(FSP_ID_REALM_PATH, appUrl).toString();
}

/** Белый список redirect_uri клиента – точное совпадение строки (никаких префиксов и шаблонов). */
export function allowedRedirectUris(appUrl: string = getEnv().APP_URL): string[] {
  return [new URL(FSP_ID_CALLBACK_PATH, appUrl).toString()];
}

interface CodeEntry {
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string;
  sub: string;
  exp: number;
}
interface TokenEntry {
  sub: string;
  exp: number;
}
interface MockState {
  key: SigningKey;
  codes: Map<string, CodeEntry>;
  tokens: Map<string, TokenEntry>;
}

const G = globalThis as unknown as { __fspIdMock?: MockState };

function state(): MockState {
  if (!G.__fspIdMock) {
    G.__fspIdMock = { key: generateSigningKey(`fsp-mock-${randomBytes(6).toString('hex')}`), codes: new Map(), tokens: new Map() };
  }
  return G.__fspIdMock;
}

/** Только для тестов: сбросить ключ и хранилища. */
export function resetMockProvider(): void {
  G.__fspIdMock = undefined;
}

function prune<T extends { exp: number }>(m: Map<string, T>, now: number) {
  for (const [k, v] of m) if (v.exp <= now) m.delete(k);
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value!);
}

export function discovery(issuer: string = fspIssuer()) {
  const oidc = `${issuer}/protocol/openid-connect`;
  return {
    issuer,
    authorization_endpoint: `${oidc}/auth`,
    token_endpoint: `${oidc}/token`,
    userinfo_endpoint: `${oidc}/userinfo`,
    jwks_uri: `${oidc}/certs`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'azp', 'name', 'preferred_username'],
  };
}

export function jwks(): Jwks {
  return { keys: [state().key.publicJwk] };
}

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** Ошибка, о которой нельзя сообщить редиректом: redirect_uri не проверен – показываем страницу. */
export type AuthorizeResult =
  | { ok: true; req: AuthorizeRequest }
  | { ok: false; fatal: true; message: string }
  | { ok: false; fatal: false; redirectUri: string; state: string; error: string };

const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Проверка запроса авторизации. Сначала client_id и redirect_uri (белый список): до этого ошибку
 * нельзя отправлять редиректом – иначе open redirect. Потом response_type, scope, state, nonce, PKCE.
 */
export function validateAuthorize(p: URLSearchParams, appUrl: string = getEnv().APP_URL): AuthorizeResult {
  const clientId = p.get('client_id') ?? '';
  const redirectUri = p.get('redirect_uri') ?? '';
  if (clientId !== FSP_ID_CLIENT_ID) return { ok: false, fatal: true, message: 'Неизвестный client_id' };
  if (!allowedRedirectUris(appUrl).includes(redirectUri)) return { ok: false, fatal: true, message: 'redirect_uri не зарегистрирован для клиента' };
  const st = p.get('state') ?? '';
  const fail = (error: string): AuthorizeResult => ({ ok: false, fatal: false, redirectUri, state: st, error });
  if (p.get('response_type') !== 'code') return fail('unsupported_response_type');
  if (!(p.get('scope') ?? '').split(' ').includes('openid')) return fail('invalid_scope');
  if (st.length < 16 || st.length > 256) return fail('invalid_request');
  const nonce = p.get('nonce') ?? '';
  if (nonce.length < 16 || nonce.length > 256) return fail('invalid_request');
  const challenge = p.get('code_challenge') ?? '';
  if (p.get('code_challenge_method') !== 'S256' || challenge.length !== 43 || !B64URL.test(challenge)) return fail('invalid_request');
  return { ok: true, req: { clientId, redirectUri, state: st, nonce, codeChallenge: challenge } };
}

/** Участник выбран на странице входа мока → одноразовый код на 60 с. */
export function issueCode(req: AuthorizeRequest, participant: FspDemoParticipant, nowSec = Math.floor(Date.now() / 1000)): string {
  const s = state();
  prune(s.codes, nowSec);
  const code = randomBytes(32).toString('base64url');
  s.codes.set(code, { clientId: req.clientId, redirectUri: req.redirectUri, challenge: req.codeChallenge, nonce: req.nonce, sub: participant.sub, exp: nowSec + CODE_TTL_SEC });
  return code;
}

export interface TokenResult {
  status: number;
  body: Record<string, unknown>;
}

const oauthError = (error: string, description: string, status = 400): TokenResult => ({ status, body: { error, error_description: description } });

function pkceMatches(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(verifier)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Token endpoint (RFC 6749 § 4.1.3 + RFC 7636 § 4.6): код одноразовый (удаляется до проверок –
 * повтор не пройдёт), совпадение client_id и redirect_uri с запросом авторизации, PKCE S256.
 */
export function exchangeToken(form: URLSearchParams, issuer: string = fspIssuer(), nowSec = Math.floor(Date.now() / 1000)): TokenResult {
  if (form.get('grant_type') !== 'authorization_code') return oauthError('unsupported_grant_type', 'Поддерживается только authorization_code');
  const s = state();
  const code = form.get('code') ?? '';
  const entry = s.codes.get(code);
  if (entry) s.codes.delete(code);
  if (!entry || entry.exp <= nowSec) return oauthError('invalid_grant', 'Код недействителен или истёк');
  if (form.get('client_id') !== entry.clientId) return oauthError('invalid_client', 'client_id не совпадает', 401);
  if (form.get('redirect_uri') !== entry.redirectUri) return oauthError('invalid_grant', 'redirect_uri не совпадает');
  if (!pkceMatches(form.get('code_verifier') ?? '', entry.challenge)) return oauthError('invalid_grant', 'PKCE: code_verifier не подходит');

  const participant = fspDemoParticipant(entry.sub);
  const accessToken = randomBytes(32).toString('base64url');
  prune(s.tokens, nowSec);
  s.tokens.set(accessToken, { sub: entry.sub, exp: nowSec + TOKEN_TTL_SEC });
  const idToken = signJwt(
    {
      iss: issuer,
      sub: entry.sub,
      aud: entry.clientId,
      azp: entry.clientId,
      exp: nowSec + TOKEN_TTL_SEC,
      iat: nowSec,
      auth_time: nowSec,
      nonce: entry.nonce,
      name: participant?.name ?? 'Участник ФСП (демо)',
      preferred_username: `fsp-${entry.sub.slice(0, 8)}`,
    },
    s.key,
  );
  return { status: 200, body: { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_TTL_SEC, id_token: idToken, scope: 'openid profile' } };
}

/** UserInfo по Bearer-токену; null – токен неизвестен или истёк. */
export function userInfo(authorization: string | null, nowSec = Math.floor(Date.now() / 1000)): Record<string, unknown> | null {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(authorization ?? '');
  if (!m) return null;
  const t = state().tokens.get(m[1]!);
  if (!t || t.exp <= nowSec) return null;
  const p = fspDemoParticipant(t.sub);
  return { sub: t.sub, name: p?.name ?? 'Участник ФСП (демо)', preferred_username: `fsp-${t.sub.slice(0, 8)}` };
}

/** Транспорт клиента поверх мока (в том же процессе): для тестов клиента без сети. */
export function mockTransport(appUrl: string = getEnv().APP_URL, clientId: string = FSP_ID_CLIENT_ID): FspIdTransport {
  const issuer = fspIssuer(appUrl);
  return {
    issuer,
    clientId,
    redirectUri: allowedRedirectUris(appUrl)[0]!,
    authorizationEndpoint: async () => discovery(issuer).authorization_endpoint,
    token: async (form) => exchangeToken(form, issuer),
    jwks: async () => jwks(),
  };
}
