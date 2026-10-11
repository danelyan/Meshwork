import 'server-only';

import { randomBytes } from 'node:crypto';

import type { StaffRole } from '@prisma/client';

import { PASSWORD_MAX, PASSWORD_MIN, dummyPasswordHash, hashPassword, verifyPassword } from '@/server/auth/password';
import { passwordVersionOf } from '@/server/auth/password-version';
import { RATE, clientKey, hit } from '@/server/auth/rate-limit';
import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { errors } from '@/server/errors';

import { audit, requireReason } from './audit';
import type { StaffContext } from './session';
import { ADMIN_SESSION_TTL_SEC } from './session';
import { DEMO_STAFF_EMAIL } from './permissions';
import { generateTotpSecret, openTotpSecret, otpauthUri, sealTotpSecret, verifyTotp } from './totp';

/** Лимиты входа персонала (in-memory, как у пользовательского входа). */
export const ADMIN_RATE = {
  perClient: { limit: 30, windowMs: 15 * 60_000 },
  perEmail: RATE.loginPerEmail,
  totpPerStaff: { limit: 10, windowMs: 15 * 60_000 },
} as const;

const BAD_LOGIN = 'Неверная почта или пароль';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type LoginStep = { step: 'totp'; staffId: string; pv: string } | { step: 'setup'; staffId: string; pv: string; secret: string; otpauthUri: string };

/**
 * Шаг 1: почта + пароль. Неверная пара, нет такого или отключён – одинаковый 401 за одинаковое время (scrypt по
 * пустышке). TOTP ещё не настроен – выдаём секрет (создаём при первом входе), сотрудник подтверждает его кодом.
 */
export async function passwordStep(req: Request, emailRaw: string, password: string): Promise<LoginStep> {
  const email = normalizeEmail(emailRaw);
  if (!hit(`admin:client:${clientKey(req)}`, ADMIN_RATE.perClient) || !hit(`admin:login:${email}`, ADMIN_RATE.perEmail)) {
    throw errors.rateLimited('Слишком много попыток входа. Подождите несколько минут.');
  }
  const staff = await prisma.staffMember.findUnique({ where: { email } });
  const ok = await verifyPassword(password, staff?.passwordHash ?? (await dummyPasswordHash()));
  if (!staff || !ok || staff.disabledAt) throw errors.unauthorized(BAD_LOGIN);
  const pv = passwordVersionOf(staff.passwordHash);
  if (staff.totpEnabledAt && staff.totpSecret) return { step: 'totp', staffId: staff.id, pv };
  // Секрет, выданный при прошлой попытке настройки, переиспользуем; нечитаемый (сменили SESSION_SECRET) – новый.
  const opened = staff.totpSecret ? openTotpSecret(staff.totpSecret, getEnv().SESSION_SECRET) : null;
  const secret = opened ?? generateTotpSecret();
  if (!opened || staff.totpEnabledAt) {
    await prisma.staffMember.update({ where: { id: staff.id }, data: { totpSecret: sealTotpSecret(secret, getEnv().SESSION_SECRET), totpEnabledAt: null } });
  }
  return { step: 'setup', staffId: staff.id, pv, secret, otpauthUri: otpauthUri(secret, email) };
}

/**
 * Шаг 2: код TOTP по промежуточной куке. Верный код → (при настройке – включаем TOTP) новая AdminSession.
 * Повтор уже принятого шага отклоняется атомарно (`totpLastStep`), пароль, сменённый после шага 1, – тоже.
 */
export async function totpStep(req: Request, pre: { staffId: string; pv: string }, code: string, now = new Date()): Promise<{ sessionId: string; staffId: string }> {
  if (!hit(`admin:totp:${pre.staffId}`, ADMIN_RATE.totpPerStaff) || !hit(`admin:client:${clientKey(req)}`, ADMIN_RATE.perClient)) {
    throw errors.rateLimited('Слишком много попыток. Подождите несколько минут.');
  }
  const staff = await prisma.staffMember.findUnique({ where: { id: pre.staffId } });
  if (!staff || staff.disabledAt || passwordVersionOf(staff.passwordHash) !== pre.pv || !staff.totpSecret) throw errors.unauthorized('Войдите заново');
  const secret = openTotpSecret(staff.totpSecret, getEnv().SESSION_SECRET);
  const step = secret ? verifyTotp(secret, code.trim(), now.getTime()) : null;
  if (step === null) throw errors.unauthorized('Неверный код');
  const setup = !staff.totpEnabledAt;
  const ip = clientKey(req);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.staffMember.updateMany({
      where: { id: staff.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, ...(setup ? { totpEnabledAt: now } : {}) },
    });
    if (claimed.count !== 1) throw errors.unauthorized('Код уже использован. Дождитесь следующего.');
    const session = await tx.adminSession.create({
      data: { staffId: staff.id, expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_SEC * 1000), ip, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
      select: { id: true },
    });
    const actor = { staffId: staff.id, ip };
    if (setup) await audit({ actor, action: 'staff.totp_enabled', target: { type: 'staff', id: staff.id } }, tx);
    await audit({ actor, action: 'staff.login', target: { type: 'staff', id: staff.id } }, tx);
    return { sessionId: session.id, staffId: staff.id };
  });
}

/**
 * Демо-вход жюри: при DEMO_LOGIN – сессия сотрудника `DEMO_STAFF_EMAIL` (owner, только чтение) без пароля и TOTP.
 * Сотрудник заводится при первом нажатии; пароль у него непроверяемый (не scrypt), поэтому войти им через форму
 * нельзя. Права режет `requireStaff` (session.demoAllows), а не роль: экраны owner видны целиком.
 */
export async function demoLogin(req: Request, now = new Date()): Promise<{ sessionId: string }> {
  if (!getEnv().DEMO_LOGIN) throw errors.forbidden('Демо-вход выключен');
  if (!hit(`admin:client:${clientKey(req)}`, ADMIN_RATE.perClient)) throw errors.rateLimited('Слишком много попыток. Подождите несколько минут.');
  const ip = clientKey(req);
  return prisma.$transaction(async (tx) => {
    const staff = await tx.staffMember.upsert({
      where: { email: DEMO_STAFF_EMAIL },
      create: { email: DEMO_STAFF_EMAIL, name: 'Демо-владелец (жюри)', role: 'owner', passwordHash: 'demo-no-password', totpEnabledAt: now },
      update: {},
      select: { id: true, disabledAt: true, totpEnabledAt: true },
    });
    if (staff.disabledAt) throw errors.forbidden('Демо-вход отключён владельцем платформы');
    if (!staff.totpEnabledAt) await tx.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: now } });
    const session = await tx.adminSession.create({
      data: { staffId: staff.id, expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_SEC * 1000), ip, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
      select: { id: true },
    });
    await audit({ actor: { staffId: staff.id, ip }, action: 'staff.login', target: { type: 'staff', id: staff.id }, after: { demo: true } }, tx);
    return { sessionId: session.id };
  });
}

export async function logout(ctx: StaffContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.adminSession.updateMany({ where: { id: ctx.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actor: ctx, action: 'staff.logout', target: { type: 'staff', id: ctx.staffId } }, tx);
  });
}

function assertPassword(p: string): void {
  if (p.length < PASSWORD_MIN || p.length > PASSWORD_MAX) throw errors.badRequest(`Пароль: от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`);
}

/** Смена своего пароля: сверка текущего, остальные сессии отзываются (текущая остаётся). */
export async function changeOwnPassword(ctx: StaffContext, current: string, next: string): Promise<void> {
  assertPassword(next);
  const staff = await prisma.staffMember.findUniqueOrThrow({ where: { id: ctx.staffId } });
  if (!(await verifyPassword(current, staff.passwordHash))) throw errors.badRequest('Текущий пароль неверен');
  const passwordHash = await hashPassword(next);
  await prisma.$transaction(async (tx) => {
    await tx.staffMember.update({ where: { id: staff.id }, data: { passwordHash } });
    await tx.adminSession.updateMany({ where: { staffId: staff.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } });
    await audit({ actor: ctx, action: 'staff.password_changed', target: { type: 'staff', id: staff.id } }, tx);
  });
}

// --- управление персоналом (только owner: право manage_staff проверяет маршрут) ---

export const STAFF_PUBLIC_SELECT = { id: true, email: true, name: true, role: true, totpEnabledAt: true, disabledAt: true, createdAt: true } as const;

export async function listStaff() {
  return prisma.staffMember.findMany({ select: STAFF_PUBLIC_SELECT, orderBy: [{ disabledAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] });
}

export function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Создать сотрудника. `actor` null – CLI (первый owner). Пароль: заданный (CLI) или временный (приглашение
 * в /admin/staff – показывается владельцу один раз, сотрудник меняет его после входа).
 */
export async function createStaff(actor: StaffContext | null, input: { email: string; name: string; role: StaffRole; password?: string }) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errors.badRequest('Некорректная почта');
  const name = input.name.trim();
  if (!name) throw errors.badRequest('Укажите имя');
  const password = input.password ?? temporaryPassword();
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  const exists = await prisma.staffMember.findUnique({ where: { email }, select: { id: true } });
  if (exists) throw errors.conflict('Сотрудник с такой почтой уже есть');
  const staff = await prisma.$transaction(async (tx) => {
    const s = await tx.staffMember.create({ data: { email, name, role: input.role, passwordHash }, select: STAFF_PUBLIC_SELECT });
    await audit({ actor, action: 'staff.create', target: { type: 'staff', id: s.id }, after: { email, name, role: input.role } }, tx);
    return s;
  });
  return { staff, password: input.password ? null : password };
}

export type StaffPatch = { role: StaffRole } | { disabled: boolean } | { resetTotp: true };

/**
 * Сменить роль, отключить/включить, сбросить 2FA. Причина обязательна. Любое изменение отзывает все сессии
 * сотрудника. Нельзя оставить платформу без активного owner и нельзя менять самого себя (защита от потери доступа).
 */
export async function updateStaff(actor: StaffContext, id: string, patch: StaffPatch, reasonRaw: string | null | undefined) {
  const reason = requireReason(reasonRaw);
  if (id === actor.staffId) throw errors.badRequest('Свою учётку меняет другой владелец');
  return prisma.$transaction(async (tx) => {
    const before = await tx.staffMember.findUnique({ where: { id }, select: STAFF_PUBLIC_SELECT });
    if (!before) throw errors.notFound();
    let data: { role?: StaffRole; disabledAt?: Date | null; totpSecret?: null; totpEnabledAt?: null; totpLastStep?: null };
    let action: 'staff.role_change' | 'staff.disable' | 'staff.enable' | 'staff.totp_reset';
    if ('role' in patch) {
      data = { role: patch.role };
      action = 'staff.role_change';
    } else if ('disabled' in patch) {
      data = { disabledAt: patch.disabled ? new Date() : null };
      action = patch.disabled ? 'staff.disable' : 'staff.enable';
    } else {
      data = { totpSecret: null, totpEnabledAt: null, totpLastStep: null };
      action = 'staff.totp_reset';
    }
    const after = await tx.staffMember.update({ where: { id }, data, select: STAFF_PUBLIC_SELECT });
    const owners = await tx.staffMember.count({ where: { role: 'owner', disabledAt: null } });
    if (owners === 0) throw errors.conflict('Нельзя оставить платформу без активного владельца');
    await tx.adminSession.updateMany({ where: { staffId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actor, action, target: { type: 'staff', id }, reason, before, after }, tx);
    return after;
  });
}
