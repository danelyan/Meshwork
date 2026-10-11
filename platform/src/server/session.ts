import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { allowsLevel } from './auth/access';
import { getEnv } from './env';
import { errors } from './errors';

/**
 * Сессия — подписанная HMAC-SHA256 кука `cid`, без хранения на сервере.
 * Два формата (docs/decisions/0001-auth-yandex-id.md):
 *
 *  - старый, кандидатский (демо-вход до lane auth):
 *      `<candidateId>.<exp>.<sig>` — 3 части;
 *  - аккаунт (User):
 *      `u.<userId>.<role>.<candidateId>.<employerProfileId>.<exp>.<sig>` — 7 частей,
 *      пустые id — пустая строка;
 *  - аккаунт с паролем (lane email-auth, ADR 0001 «Дополнение 10.10»):
 *      `u.<userId>.<role>.<candidateId>.<employerProfileId>.<pv>.<exp>.<sig>` — 8 частей,
 *      `pv` — версия пароля (`passwordVersionOf`). Смена пароля меняет версию, и старые
 *      куки считаются протухшими (`sessionExists`). Аккаунты без пароля (Яндекс, демо)
 *      получают прежний 7-частный формат.
 *
 * Роль и id профиля в куке, чтобы `requireCandidate` оставался синхронным и не
 * ходил в БД. Гварды решают по активной роли (`role`), id профиля — второе условие
 * (`server/auth/access.ts`). `parseSession` к тому же отдаёт только id профиля активной роли (ADR 0004,
 * защита в глубину): у учётки с двумя ролями id неактивного профиля из куки недоступен, даже если гвард ошибся.
 * Выбор и переключение роли (`/api/auth/role`, `/api/auth/role/switch`) перевыпускают куку (`userSessionCookie`).
 * Подделка любого поля ломает подпись.
 */
export const SESSION_COOKIE = 'cid';
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPT_ID_RE = /^[A-Za-z0-9_-]{0,64}$/;
const PV_RE = /^[A-Za-z0-9_-]{1,16}$/;

export { passwordVersionOf } from './auth/password-version';

export const USER_ROLES = ['pending', 'candidate', 'employer'] as const;
export type SessionRole = (typeof USER_ROLES)[number];

/** Кто вошёл. `userId = null` — старая кука демо-кандидата без аккаунта. */
export interface SessionPrincipal {
  userId: string | null;
  role: SessionRole;
  candidateId: string | null;
  employerProfileId: string | null;
  /** Версия пароля из куки (только аккаунты с паролем); сверяет `sessionExists`. */
  passwordVersion?: string;
}

export interface UserSessionInput {
  userId: string;
  role: SessionRole;
  candidateId?: string | null;
  employerProfileId?: string | null;
  /** `passwordVersionOf(user.passwordHash)`; пусто — аккаунт без пароля, кука старого формата. */
  passwordVersion?: string | null;
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sigOk(payload: string, sig: string, secret: string): boolean {
  const expected = Buffer.from(hmac(payload, secret));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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

/** Токен сессии аккаунта (формат `u.…`). */
export function signUserSession(
  input: UserSessionInput,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
  ttlSec: number = SESSION_TTL_SEC,
): string {
  const cand = input.candidateId ?? '';
  const emp = input.employerProfileId ?? '';
  if (!ID_RE.test(input.userId) || !OPT_ID_RE.test(cand) || !OPT_ID_RE.test(emp)) {
    throw new Error('signUserSession: недопустимый id');
  }
  if (!USER_ROLES.includes(input.role)) throw new Error('signUserSession: недопустимая роль');
  const pv = input.passwordVersion ?? '';
  if (pv && !PV_RE.test(pv)) throw new Error('signUserSession: недопустимая версия пароля');
  const payload = pv
    ? `u.${input.userId}.${input.role}.${cand}.${emp}.${pv}.${nowSec + ttlSec}`
    : `u.${input.userId}.${input.role}.${cand}.${emp}.${nowSec + ttlSec}`;
  return `${payload}.${hmac(payload, secret)}`;
}

/** Разбор любой из двух форм куки; null — нет подписи, подделка, истёк срок. */
export function parseSession(
  token: string | undefined | null,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
): SessionPrincipal | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length === 3) {
    const [id, exp, sig] = parts as [string, string, string];
    if (!ID_RE.test(id) || !/^\d{1,12}$/.test(exp)) return null;
    if (!sigOk(`${id}.${exp}`, sig, secret) || Number(exp) <= nowSec) return null;
    return { userId: null, role: 'candidate', candidateId: id, employerProfileId: null };
  }
  if ((parts.length === 7 || parts.length === 8) && parts[0] === 'u') {
    const withPv = parts.length === 8;
    const [, userId, role, cand, emp] = parts as [string, string, string, string, string];
    const pv = withPv ? parts[5]! : '';
    const exp = parts[parts.length - 2]!;
    const sig = parts[parts.length - 1]!;
    if (!ID_RE.test(userId) || !OPT_ID_RE.test(cand) || !OPT_ID_RE.test(emp) || !/^\d{1,12}$/.test(exp)) return null;
    if (withPv && !PV_RE.test(pv)) return null;
    if (!(USER_ROLES as readonly string[]).includes(role)) return null;
    if (!sigOk(parts.slice(0, -1).join('.'), sig, secret) || Number(exp) <= nowSec) return null;
    const principal: SessionPrincipal = {
      userId,
      role: role as SessionRole,
      candidateId: role === 'candidate' && cand ? cand : null,
      employerProfileId: role === 'employer' && emp ? emp : null,
    };
    if (withPv) principal.passwordVersion = pv;
    return principal;
  }
  return null;
}

/** candidateId или null (обе формы куки). */
export function verifySession(
  token: string | undefined | null,
  secret: string = getEnv().SESSION_SECRET,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  return parseSession(token, secret, nowSec)?.candidateId ?? null;
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

/** Сессия из запроса или null. */
export function getSession(req: Request): SessionPrincipal | null {
  return parseSession(readCookie(req, SESSION_COOKIE));
}

/**
 * Кандидат по активной роли: 401 — нет сессии; 403 — активна другая роль (работодатель, pending) или нет
 * профиля кандидата. Чистая функция (тесты без запроса). Старая демо-кука (userId = null) — кандидат.
 */
export function candidateFrom(s: SessionPrincipal | null): string {
  if (!s) throw errors.unauthorized();
  if (!allowsLevel('candidate', s)) throw errors.forbidden('Доступно только кандидату');
  return s.candidateId!;
}

/** Работодатель по активной роли: 401 — нет сессии; 403 — другая роль, нет аккаунта или профиля работодателя. */
export function employerFrom(s: SessionPrincipal | null): { userId: string; employerProfileId: string } {
  if (!s) throw errors.unauthorized();
  if (!allowsLevel('employer', s)) throw errors.forbidden('Доступно только работодателю');
  return { userId: s.userId!, employerProfileId: s.employerProfileId! };
}

/**
 * candidateId или AppError (см. `candidateFrom`). Синхронная: проверяет только подпись и срок;
 * существование кандидата и владение объектом проверяет сервис. Уровень `candidate` в `API_ACCESS`.
 */
export function requireCandidate(req: Request): string {
  return candidateFrom(getSession(req));
}

/** Аккаунт (любая роль, включая pending). Старая кука без аккаунта → 401. Уровень `account` в `API_ACCESS`. */
export function requireUser(req: Request): SessionPrincipal & { userId: string } {
  const s = getSession(req);
  if (!s?.userId) throw errors.unauthorized();
  return s as SessionPrincipal & { userId: string };
}

/** Работодатель: 401 — нет входа, 403 — другая активная роль (см. `employerFrom`). Уровень `employer`. */
export function requireEmployer(req: Request): { userId: string; employerProfileId: string } {
  return employerFrom(getSession(req));
}

/** Параметры для `NextResponse.cookies.set(...)` (docs Next.js: NextResponse.cookies). */
export function sessionCookie(candidateId: string) {
  return cookieWith(signSession(candidateId, getEnv().SESSION_SECRET));
}

/** Кука сессии аккаунта. Вызывать после входа и после смены роли (ротация значения). */
export function userSessionCookie(input: UserSessionInput) {
  return cookieWith(signUserSession(input, getEnv().SESSION_SECRET));
}

function cookieWith(value: string) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: getEnv().APP_URL.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_SEC,
  };
}

export function clearedSessionCookie() {
  return { name: SESSION_COOKIE, value: '', httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 0 };
}
