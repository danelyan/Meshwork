import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { assertSameOrigin } from '@/server/auth/csrf';
import { clientKey } from '@/server/auth/rate-limit';
import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { errors } from '@/server/errors';
import { readCookie } from '@/server/session';

import { type Action, DEMO_READONLY_MESSAGE, DEMO_STAFF_ACTIONS, DEMO_STAFF_EMAIL, type StaffRoleName, can } from './permissions';

/**
 * Сессия персонала (ADR 0009). Граница доверия:
 *  - своя кука `fsp_admin` = `a.<adminSessionId>.<exp>.<sig>`, HMAC с доменом `admin:` — подпись не совпадёт
 *    с `cid` (домен без префикса) и `fsp_expert` (`expert:`) даже на тех же байтах; parseSession её не примет,
 *    а `cid` не примет `verifyAdminToken` (другое число частей и префикс);
 *  - id в куке — строка AdminSession: отзыв (выход, смена роли, отключение, сброс 2FA) действует сразу;
 *  - каждый запрос сверяет сессию (не отозвана, не истекла) и сотрудника (не отключён, TOTP включён);
 *  - мутации — CSRF-проверка Origin внутри `requireStaff` (как у остальных POST, `auth/csrf.ts`);
 *  - промежуточная кука `fsp_admin_pre` (пароль верен, ждём TOTP) живёт 5 минут на path /api/admin/auth
 *    и привязана к версии пароля сотрудника.
 */

export const ADMIN_COOKIE = 'fsp_admin';
export const ADMIN_PRE_COOKIE = 'fsp_admin_pre';
export const ADMIN_PRE_PATH = '/api/admin/auth';
export const ADMIN_SESSION_TTL_SEC = 12 * 60 * 60;
export const ADMIN_PRE_TTL_SEC = 5 * 60;
export const ADMIN_LOGIN_PATH = '/admin/login';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PV_RE = /^[A-Za-z0-9_-]{0,16}$/;

function sign(domain: 'admin' | 'admin-pre', payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${domain}:${payload}`).digest('base64url');
}

function sigOk(domain: 'admin' | 'admin-pre', payload: string, sig: string, secret: string): boolean {
  const expected = Buffer.from(sign(domain, payload, secret));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signAdminToken(sessionId: string, secret = getEnv().SESSION_SECRET, nowSec = Math.floor(Date.now() / 1000), ttlSec = ADMIN_SESSION_TTL_SEC): string {
  if (!ID_RE.test(sessionId)) throw new Error('signAdminToken: недопустимый id');
  const payload = `a.${sessionId}.${nowSec + ttlSec}`;
  return `${payload}.${sign('admin', payload, secret)}`;
}

/** id AdminSession из куки; null — нет, подделка, чужой формат (`cid`, `fsp_expert`), истёк срок. */
export function verifyAdminToken(token: string | null | undefined, secret = getEnv().SESSION_SECRET, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'a') return null;
  const [, id, exp, sig] = parts as [string, string, string, string];
  if (!ID_RE.test(id) || !/^\d{1,12}$/.test(exp)) return null;
  if (!sigOk('admin', `a.${id}.${exp}`, sig, secret) || Number(exp) <= nowSec) return null;
  return id;
}

/** Промежуточный токен «пароль верен»: `p.<staffId>.<passwordVersion>.<exp>.<sig>`. */
export function signPreToken(staffId: string, pv: string, secret = getEnv().SESSION_SECRET, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!ID_RE.test(staffId) || !PV_RE.test(pv)) throw new Error('signPreToken: недопустимый id');
  const payload = `p.${staffId}.${pv}.${nowSec + ADMIN_PRE_TTL_SEC}`;
  return `${payload}.${sign('admin-pre', payload, secret)}`;
}

export function verifyPreToken(token: string | null | undefined, secret = getEnv().SESSION_SECRET, nowSec = Math.floor(Date.now() / 1000)): { staffId: string; pv: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'p') return null;
  const [, staffId, pv, exp, sig] = parts as [string, string, string, string, string];
  if (!ID_RE.test(staffId) || !PV_RE.test(pv) || !/^\d{1,12}$/.test(exp)) return null;
  if (!sigOk('admin-pre', `p.${staffId}.${pv}.${exp}`, sig, secret) || Number(exp) <= nowSec) return null;
  return { staffId, pv };
}

function secure(): boolean {
  return getEnv().APP_URL.startsWith('https://');
}

/** Кука сессии персонала. path=/ — её читают и страницы /admin, и /api/admin; SameSite=Strict. */
export function adminCookie(sessionId: string) {
  return { name: ADMIN_COOKIE, value: signAdminToken(sessionId), httpOnly: true, sameSite: 'strict' as const, secure: secure(), path: '/', maxAge: ADMIN_SESSION_TTL_SEC };
}

export function clearAdminCookie() {
  return { name: ADMIN_COOKIE, value: '', httpOnly: true, sameSite: 'strict' as const, secure: secure(), path: '/', maxAge: 0 };
}

export function preCookie(staffId: string, pv: string) {
  return { name: ADMIN_PRE_COOKIE, value: signPreToken(staffId, pv), httpOnly: true, sameSite: 'strict' as const, secure: secure(), path: ADMIN_PRE_PATH, maxAge: ADMIN_PRE_TTL_SEC };
}

export function clearPreCookie() {
  return { name: ADMIN_PRE_COOKIE, value: '', httpOnly: true, sameSite: 'strict' as const, secure: secure(), path: ADMIN_PRE_PATH, maxAge: 0 };
}

/** Кто из персонала вошёл. Передаётся в `audit({ actor })` и `revealPii`. */
export interface StaffContext {
  staffId: string;
  sessionId: string;
  role: StaffRoleName;
  name: string;
  email: string;
  /** Демо-сотрудник жюри (`DEMO_STAFF_EMAIL`): только чтение, см. permissions.ts. */
  demo: boolean;
  /** Адрес клиента (X-Forwarded-For) — для журнала; null на страницах. */
  ip: string | null;
}

/** Демо-сотруднику — только чтение: право из `DEMO_STAFF_ACTIONS` и никаких мутаций, кроме выхода. */
export function demoAllows(req: Request, action?: Action): boolean {
  if (action && !DEMO_STAFF_ACTIONS.has(action)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return new URL(req.url).pathname === '/api/admin/auth/logout';
}

/** Сессия по id из куки: жива, сотрудник активен и с включённым TOTP. */
async function loadStaffSession(sessionId: string, now = new Date()): Promise<Omit<StaffContext, 'ip'> | null> {
  const s = await prisma.adminSession.findUnique({
    where: { id: sessionId },
    select: { id: true, expiresAt: true, revokedAt: true, staff: { select: { id: true, role: true, name: true, email: true, disabledAt: true, totpEnabledAt: true } } },
  });
  if (!s || s.revokedAt || s.expiresAt <= now) return null;
  if (s.staff.disabledAt || !s.staff.totpEnabledAt) return null;
  const demo = s.staff.email === DEMO_STAFF_EMAIL;
  // Демо-сессии живут только пока на стенде включён DEMO_LOGIN: выключили флаг — они сразу недействительны.
  if (demo && !getEnv().DEMO_LOGIN) return null;
  return { staffId: s.staff.id, sessionId: s.id, role: s.staff.role, name: s.staff.name, email: s.staff.email, demo };
}

/**
 * Гвард route handler'ов `/api/admin/*`: 401 без живой сессии персонала (пользовательская `cid` не подходит),
 * 403 без права `action`. Для мутаций (не GET/HEAD) — CSRF-проверка Origin. Без `action` — любой сотрудник.
 * Тест матрицы доступа требует вызова именно в форме `requireStaff(req…)`.
 */
export async function requireStaff(req: Request, action?: Action): Promise<StaffContext> {
  if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
  const id = verifyAdminToken(readCookie(req, ADMIN_COOKIE));
  const ctx = id ? await loadStaffSession(id) : null;
  if (!ctx) throw errors.unauthorized('Нужен вход в админку');
  if (action && !can(ctx.role, action)) throw errors.forbidden('Недостаточно прав');
  if (ctx.demo && !demoAllows(req, action)) throw errors.forbidden(DEMO_READONLY_MESSAGE);
  return { ...ctx, ip: clientKey(req) };
}

/** Сессия персонала в Server Component (одна выборка на запрос). null — не вошёл. */
export const getStaffPageSession = cache(async (): Promise<StaffContext | null> => {
  const id = verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
  const ctx = id ? await loadStaffSession(id) : null;
  return ctx ? { ...ctx, ip: null } : null;
});

/**
 * Гвард страниц `/admin/*` (вызывать в каждой `page.tsx`, не в layout — layout не перерисовывается при
 * клиентской навигации; docs Next.js «Layouts and auth checks»). Не вошёл → /admin/login?next=…;
 * нет права → /admin (обзор доступен всем ролям). `path` — адрес этой страницы.
 */
export async function requirePageStaff(path: string, action?: Action): Promise<StaffContext> {
  const ctx = await getStaffPageSession();
  if (!ctx) redirect(`${ADMIN_LOGIN_PATH}?next=${encodeURIComponent(path)}`);
  if (action && !can(ctx.role, action)) redirect('/admin?denied=1');
  return ctx;
}
