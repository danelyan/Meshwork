// Завести сотрудника админки (E-08, ADR 0009). Единственный способ создать первого owner — на сервере:
//
//   printf '%s' "$PASS" | npx tsx scripts/admin-create.ts --email owner@example.ru --name "Иван" --role owner
//   ADMIN_PASSWORD=… npx tsx scripts/admin-create.ts --email … --name … --role moderator
//
// Пароль — из stdin или env ADMIN_PASSWORD, никогда из аргументов (их видно в `ps` и истории shell).
// TOTP сотрудник настраивает при первом входе на /admin/login.
// Восстановление доступа (потерян телефон или сменён SESSION_SECRET): `--reset-totp --email …` — сбросить 2FA
// и отозвать сессии; при следующем входе будет выдан новый секрет. Оба действия пишутся в AdminAuditLog (actor = null).
// БД — DATABASE_URL или platform/.env (scripts/load-env.mjs).
import { PrismaClient } from '@prisma/client';

import { PASSWORD_MAX, PASSWORD_MIN, hashPassword } from '../src/server/auth/password';
import { STAFF_ROLES, isStaffRole } from '../src/server/admin/permissions';
import { loadPlatformEnv } from './load-env.mjs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function fail(msg: string): never {
  console.error(`admin-create: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadPlatformEnv();
  const email = arg('email')?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('нужен --email');
  if (process.argv.includes('--password')) fail('пароль не передаётся аргументом: stdin или ADMIN_PASSWORD');
  const db = new PrismaClient();
  try {
    if (process.argv.includes('--reset-totp')) {
      const s = await db.staffMember.findUnique({ where: { email }, select: { id: true } });
      if (!s) fail('сотрудник не найден');
      await db.$transaction([
        db.staffMember.update({ where: { id: s.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
        db.adminSession.updateMany({ where: { staffId: s.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        db.adminAuditLog.create({ data: { actorId: null, action: 'staff.totp_reset', targetType: 'staff', targetId: s.id, reason: 'CLI admin-create --reset-totp' } }),
      ]);
      console.log(`2FA сброшена: ${email}; новый секрет выдаётся при следующем входе`);
      return;
    }
    const name = arg('name')?.trim();
    const role = arg('role') ?? '';
    if (!name) fail('нужен --name');
    if (!isStaffRole(role)) fail(`--role: одна из ${STAFF_ROLES.join(', ')}`);
    const password = process.env.ADMIN_PASSWORD || (await readStdin());
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) fail(`пароль (stdin или ADMIN_PASSWORD): от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`);
    if (await db.staffMember.findUnique({ where: { email }, select: { id: true } })) fail('сотрудник с такой почтой уже есть');
    const passwordHash = await hashPassword(password);
    const staff = await db.$transaction(async (tx) => {
      const s = await tx.staffMember.create({ data: { email, name, role, passwordHash }, select: { id: true } });
      await tx.adminAuditLog.create({ data: { actorId: null, action: 'staff.create', targetType: 'staff', targetId: s.id, reason: 'CLI admin-create', after: { email, name, role } } });
      return s;
    });
    const url = new URL(process.env.DATABASE_URL ?? 'postgresql://unset');
    console.log(`создан ${role} ${email} (${staff.id}) в БД ${url.hostname}:${url.port}${url.pathname}; вход — /admin/login, TOTP настраивается при первом входе`);
  } finally {
    await db.$disconnect();
  }
}

void main();
