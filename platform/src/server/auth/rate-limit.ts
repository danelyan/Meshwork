/**
 * Простой ограничитель частоты в памяти процесса (фиксированное окно). На стенде один
 * экземпляр приложения, поэтому памяти достаточно; при нескольких репликах лимит
 * считается на каждую отдельно. Попытки ввода кода дополнительно ограничены в БД
 * (`AuthCode.attempts`).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateRule {
  /** Сколько событий разрешено в окне. */
  limit: number;
  windowMs: number;
}

export const RATE = {
  /** Письма с кодом на один адрес. */
  sendPerEmail: { limit: 5, windowMs: 15 * 60_000 },
  /** Попытки входа на одну почту. */
  loginPerEmail: { limit: 10, windowMs: 15 * 60_000 },
  /** Любые запросы auth-форм с одного адреса клиента. */
  perClient: { limit: 60, windowMs: 15 * 60_000 },
  /** Попытки ввода кода на одну почту (поверх 5 попыток на сам код). */
  codePerEmail: { limit: 20, windowMs: 15 * 60_000 },
} satisfies Record<string, RateRule>;

/** true — событие разрешено и учтено; false — лимит исчерпан. */
export function hit(key: string, rule: RateRule, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 10_000) sweep(now);
    return true;
  }
  if (b.count >= rule.limit) return false;
  b.count += 1;
  return true;
}

function sweep(now: number) {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Адрес клиента для лимита: первый из X-Forwarded-For (Caddy), иначе общий ключ. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip') || 'unknown';
}

/** Только для тестов. */
export function resetRateLimits(): void {
  buckets.clear();
}
