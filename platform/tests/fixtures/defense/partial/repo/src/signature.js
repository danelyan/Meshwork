import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SEC = 300;

// Подпись считается по сырому телу: после JSON.parse/stringify порядок ключей и пробелы
// могут поменяться, и HMAC не сойдётся.
export function sign(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifySignature({ secret, header, rawBody, nowSec }) {
  if (typeof header !== 'string') return { ok: false, reason: 'missing' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSec - timestamp) > TOLERANCE_SEC) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(sign(secret, timestamp, rawBody), 'hex');
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  if (given.length !== expected.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(given, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
