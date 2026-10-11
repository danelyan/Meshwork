import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import type { AuthCodePurpose } from '@prisma/client';

import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';

/** Код живёт 15 минут, на один код – 5 попыток ввода. */
export const CODE_TTL_MS = 15 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;

/** 6 цифр, равномерно (crypto.randomInt). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * HMAC-хэш кода. Ключ – SESSION_SECRET, в сообщении назначение и пользователь: утёкшая
 * таблица без секрета не даёт перебрать миллион кодов офлайн, а код сброса не подходит
 * для подтверждения и чужого аккаунта.
 */
export function hashCode(code: string, purpose: AuthCodePurpose, userId: string, secret = getEnv().SESSION_SECRET): string {
  return createHmac('sha256', secret).update(`authcode:${purpose}:${userId}:${code}`).digest('base64url');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Выпустить новый код: прежние неиспользованные коды того же назначения гасятся. */
export async function issueCode(userId: string, purpose: AuthCodePurpose, now = new Date()): Promise<string> {
  const code = generateCode();
  await prisma.$transaction([
    prisma.authCode.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: now } }),
    prisma.authCode.create({
      data: { userId, purpose, codeHash: hashCode(code, purpose, userId), expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
    }),
  ]);
  return code;
}

export type CodeCheck = 'ok' | 'invalid' | 'expired' | 'exhausted';

/**
 * Проверить и погасить код. Берётся последний живой код назначения; неверный ввод
 * увеличивает счётчик попыток, после 5-й код сгорает. Погашение – условным update,
 * чтобы два параллельных запроса с верным кодом не прошли оба.
 */
export async function consumeCode(userId: string, purpose: AuthCodePurpose, code: string, now = new Date()): Promise<CodeCheck> {
  const row = await prisma.authCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return 'invalid';
  if (row.expiresAt <= now) return 'expired';
  if (row.attempts >= CODE_MAX_ATTEMPTS) return 'exhausted';
  if (!sameHash(row.codeHash, hashCode(code, purpose, userId))) {
    await prisma.authCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return row.attempts + 1 >= CODE_MAX_ATTEMPTS ? 'exhausted' : 'invalid';
  }
  const done = await prisma.authCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  return done.count === 1 ? 'ok' : 'invalid';
}
