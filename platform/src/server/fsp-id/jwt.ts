import { createPublicKey, createSign, generateKeyPairSync, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

/**
 * JWT RS256 и JWKS на node:crypto, без библиотек (RFC 7515/7517/7518/7519). Только то, что нужно
 * ID-токену OIDC: подпись провайдера-мока и проверка подписи и claims на стороне клиента.
 */

/** Ключ из JWKS провайдера (у Keycloak бывают и ключи шифрования `use: enc` – их пропускаем). */
export interface Jwk extends JsonWebKey {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface Jwks {
  keys: Jwk[];
}

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: Jwk & { kid: string; n: string; e: string };
}

const b64json = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** Новая пара RSA-2048 в памяти. Приватный ключ не покидает процесс и нигде не сохраняется. */
export function generateSigningKey(kid: string): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  return { kid, privateKey, publicJwk: { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e } };
}

export function signJwt(payload: Record<string, unknown>, key: SigningKey): string {
  const head = b64json({ alg: 'RS256', typ: 'JWT', kid: key.kid });
  const body = b64json(payload);
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** Причина отказа в проверке ID-токена – машинный код для логов и редиректа (без самого токена). */
export type IdTokenError =
  | 'malformed'
  | 'alg'
  | 'kid'
  | 'signature'
  | 'iss'
  | 'aud'
  | 'azp'
  | 'exp'
  | 'iat'
  | 'nonce'
  | 'sub';

export class IdTokenInvalid extends Error {
  constructor(readonly reason: IdTokenError) {
    super(`id_token: ${reason}`);
    this.name = 'IdTokenInvalid';
  }
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  azp?: string;
  name?: string;
  preferred_username?: string;
  [k: string]: unknown;
}

export interface VerifyOptions {
  issuer: string;
  clientId: string;
  nonce: string;
  nowSec?: number;
  /** Допуск расхождения часов, с. */
  skewSec?: number;
}

function parsePart(part: string): Record<string, unknown> {
  const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new IdTokenInvalid('malformed');
  return v as Record<string, unknown>;
}

/**
 * Проверка ID-токена по OIDC Core § 3.1.3.7: алгоритм только RS256 (никаких `none`/HS256),
 * ключ по `kid` из JWKS провайдера, подпись, `iss`, `aud` (и `azp` при нескольких аудиториях),
 * `exp`, `iat`, `nonce`. Любое нарушение – IdTokenInvalid с причиной.
 */
export function verifyIdToken(token: string, jwks: Jwks, opts: VerifyOptions): IdTokenClaims {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = opts.skewSec ?? 30;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))) throw new IdTokenInvalid('malformed');
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = parsePart(h);
    claims = parsePart(p);
  } catch {
    throw new IdTokenInvalid('malformed');
  }
  if (header.alg !== 'RS256') throw new IdTokenInvalid('alg');
  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA' && (k.use === undefined || k.use === 'sig') && k.n && k.e);
  if (!jwk || typeof header.kid !== 'string') throw new IdTokenInvalid('kid');
  let ok = false;
  try {
    const pub = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new IdTokenInvalid('signature');

  if (claims.iss !== opts.issuer) throw new IdTokenInvalid('iss');
  const aud = claims.aud;
  const auds = Array.isArray(aud) ? aud : [aud];
  if (!auds.includes(opts.clientId)) throw new IdTokenInvalid('aud');
  if ((auds.length > 1 || claims.azp !== undefined) && claims.azp !== opts.clientId) throw new IdTokenInvalid('azp');
  if (typeof claims.exp !== 'number' || claims.exp + skew <= now) throw new IdTokenInvalid('exp');
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) throw new IdTokenInvalid('iat');
  if (typeof claims.nonce !== 'string' || claims.nonce !== opts.nonce) throw new IdTokenInvalid('nonce');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new IdTokenInvalid('sub');
  return claims as IdTokenClaims;
}
