import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from './env';
import { errors } from './errors';

/**
 * Сессия кандидата — подписанная HMAC-SHA256 кука `cid`:
 *   `<candidateId>.<expiresAtUnixSec>.<base64url(hmac(candidateId.expiresAt))>`
 * Без хранения на сервере. Подделка id или срока ломает подпись.
 */
export const SESSION_COOKIE = 'cid';
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signSession(
  candidateId: string,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
  ttlSec: number = SESSION_TTL_SEC,
): string {
  if (!ID_RE.test(candidateId)) throw new Error('signSession: недопустимый candidateId');
  const payload = `${candidateId}.${nowSec + ttlSec}`;
  return `${payload}.${hmac(payload, secret)}`;
}

/** candidateId или null (нет подписи, подделка, истёк срок). */
export function verifySession(
  token: string | undefined | null,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts as [string, string, string];
  if (!ID_RE.test(id) || !/^\d{1,12}$/.test(exp)) return null;
  const expected = Buffer.from(hmac(`${id}.${exp}`, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Number(exp) <= nowSec) return null;
  return id;
}

/** Значение куки из заголовка Cookie (без зависимости от next/headers — работает и в тестах). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

/** candidateId из подписанной куки или null. */
export function getCandidateId(req: Request): string | null {
  return verifySession(readCookie(req, SESSION_COOKIE));
}

/**
 * candidateId или AppError 401 (`unauthorized`). Синхронная: проверяет только
 * подпись и срок; существование кандидата и владение объектом проверяет сервис.
 */
export function requireCandidate(req: Request): string {
  const id = getCandidateId(req);
  if (!id) throw errors.unauthorized();
  return id;
}

/** Параметры для `NextResponse.cookies.set(...)` (docs Next.js: NextResponse.cookies). */
export function sessionCookie(candidateId: string) {
  const env = getEnv();
  return {
    name: SESSION_COOKIE,
    value: signSession(candidateId, env.SESSION_SECRET),
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_SEC,
  };
}

export function clearedSessionCookie() {
  return { name: SESSION_COOKIE, value: '', httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 0 };
}
