import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';

import { ApiError, type Ctx } from './http.js';

/**
 * Проверка токенов ФСП ID (Keycloak). Токен должен быть выпущен реалмом (`iss`) для API (`aud`),
 * подписан ключом из JWKS реалма. Кто вызывает:
 *  - athlete — пользователь с claim `fsp_id` и ролью athlete (вход через браузер или password grant);
 *  - partner — сервисный аккаунт клиента с ролью partner (client_credentials).
 */
export interface Principal {
  kind: 'athlete' | 'partner';
  subject: string;
  clientId: string;
  fspId: string | null;
  roles: string[];
}

export type Verifier = (token: string) => Promise<Principal>;

export function principalFromClaims(payload: JWTPayload): Principal {
  const realmAccess = payload['realm_access'] as { roles?: unknown } | undefined;
  const roles = Array.isArray(realmAccess?.roles) ? realmAccess.roles.filter((r): r is string => typeof r === 'string') : [];
  const fspId = typeof payload['fsp_id'] === 'string' ? payload['fsp_id'] : null;
  const clientId = typeof payload['azp'] === 'string' ? payload['azp'] : typeof payload['client_id'] === 'string' ? payload['client_id'] : 'unknown';
  const subject = payload.sub ?? 'unknown';
  if (fspId && roles.includes('athlete')) return { kind: 'athlete', subject, clientId, fspId, roles };
  if (roles.includes('partner')) return { kind: 'partner', subject, clientId, fspId: null, roles };
  throw new ApiError(403, 'forbidden', 'У токена нет роли athlete (с fsp_id) или partner');
}

const BEARER_HEADER = { 'www-authenticate': 'Bearer realm="fsp-id"' };

export function createKeycloakVerifier(opts: { issuer: string; jwksUrl: string; audience: string }): Verifier {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 10_000 });
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: opts.issuer, audience: opts.audience });
      return principalFromClaims(payload);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof joseErrors.JWTExpired) throw new ApiError(401, 'token_expired', 'Токен истёк', BEARER_HEADER);
      if (err instanceof joseErrors.JWTClaimValidationFailed) {
        throw new ApiError(401, 'invalid_token', `Токен не для этого API: ${err.claim} (${err.reason})`, BEARER_HEADER);
      }
      // Не ошибка JOSE (например, сетевой сбой fetch) или таймаут JWKS — ключи реалма не получены.
      if (err instanceof joseErrors.JWKSTimeout || !(err instanceof joseErrors.JOSEError)) {
        throw new ApiError(503, 'idp_unavailable', 'ФСП ID (Keycloak) недоступен, ключи подписи не получены');
      }
      throw new ApiError(401, 'invalid_token', 'Токен не прошёл проверку подписи или формата', BEARER_HEADER);
    }
  };
}

export function bearerToken(ctx: Ctx): string | null {
  const header = ctx.req.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1]!.trim() : null;
}

export async function authenticate(ctx: Ctx, verify: Verifier): Promise<Principal> {
  const token = bearerToken(ctx);
  if (!token) throw new ApiError(401, 'unauthorized', 'Нужен заголовок Authorization: Bearer <токен ФСП ID>', BEARER_HEADER);
  return verify(token);
}

export function requireAthlete(p: Principal): Principal & { fspId: string } {
  if (p.kind !== 'athlete' || !p.fspId) throw new ApiError(403, 'forbidden', 'Доступно только спортсмену (токен пользователя с fsp_id)');
  return p as Principal & { fspId: string };
}
