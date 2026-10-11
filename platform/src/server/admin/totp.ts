import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP для входа персонала (ADR 0009) на `node:crypto`, без новых зависимостей.
 * RFC 6238: T = floor((unix - T0) / X), T0 = 0, X = 30 с, HMAC-SHA1 (по умолчанию в RFC и во всех
 * приложениях-аутентификаторах), 6 цифр; HOTP и динамическое усечение — RFC 4226 §5.3.
 * Окно приёма ±1 шаг (рассинхрон часов, RFC 6238 §5.2); повтор уже принятого шага отклоняет вызывающий
 * код по `StaffMember.totpLastStep`.
 * Секрет — 20 случайных байт (160 бит, RFC 4226 §4), в otpauth-URI — base32 без '=' (RFC 4648 §6).
 * Без `server-only`: модуль берёт CLI.
 */

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'ФСП Карьера Админ';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32: недопустимый символ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226 §5.3) для счётчика; `algo` и `digits` — для векторов RFC 6238 в тестах. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, key).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

export function totpAt(key: Buffer, nowMs: number, digits = TOTP_DIGITS, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  return hotp(key, totpStep(nowMs), digits, algo);
}

/** Номер шага, на котором код верен (в окне ±TOTP_WINDOW), иначе null. Сравнение за постоянное время. */
export function verifyTotp(secretB32: string, code: string, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const step = totpStep(nowMs);
  let found: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const expected = Buffer.from(hotp(key, step + d));
    if (timingSafeEqual(expected, Buffer.from(code)) && found === null) found = step + d;
  }
  return found;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth://totp/… для QR и ручного ввода (формат Key Uri Google Authenticator). */
export function otpauthUri(secretB32: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer: TOTP_ISSUER, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SEC) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// --- хранение секрета: AES-256-GCM, ключ из SESSION_SECRET с отдельным доменом ---
// Утечка дампа БД без env не раскрывает секреты TOTP. Смена SESSION_SECRET делает их нечитаемыми — тогда
// владелец сбрасывает 2FA (`/admin/staff` или CLI), сотрудник настраивает заново.

function keyOf(secret: string): Buffer {
  return createHash('sha256').update(`fsp-admin-totp:${secret}`).digest();
}

export function sealTotpSecret(plainB32: string, appSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(appSecret), iv);
  const ct = Buffer.concat([c.update(plainB32, 'utf8'), c.final()]);
  return `enc1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function openTotpSecret(sealed: string, appSecret: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'enc1') return null;
  try {
    const d = createDecipheriv('aes-256-gcm', keyOf(appSecret), Buffer.from(parts[1]!, 'base64url'));
    d.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(parts[3]!, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
