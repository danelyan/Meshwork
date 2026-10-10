import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Хэш пароля — scrypt из `node:crypto` (без новых зависимостей). Формат строки:
 * `scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>`, параметры хранятся в записи,
 * чтобы их можно было поднять позже без сброса старых паролей.
 * N=2^15, r=8, p=1 — рекомендация OWASP для scrypt (≈32 МБ памяти на проверку).
 */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
// maxmem по умолчанию 32 МБ, а 128·N·r = ровно 32 МБ — даём запас.
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

function derive(password: string, salt: Buffer, opts: ScryptOptions, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keylen, { ...opts, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P }, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Сверка с хэшем за постоянное время. Битая или чужая строка хэша — false, не исключение. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await derive(password, salt, { N: n, r, p }, expected.length);
  return timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;

/**
 * Хэш-пустышка: вход с несуществующей почтой тоже тратит время на scrypt,
 * чтобы по времени ответа нельзя было понять, есть ли аккаунт.
 */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(12).toString('base64url'));
  return dummy;
}
