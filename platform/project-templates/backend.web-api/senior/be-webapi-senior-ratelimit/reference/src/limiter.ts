// Эталон: token bucket на ключ, LRU-вытеснение через порядок вставки Map (O(1)).
export interface LimiterOptions {
  capacity: number;
  refillPerSec: number;
  maxKeys: number;
  now: () => number;
}

export interface Decision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetMs: number;
}

export interface Limiter {
  take(key: string, cost?: number): Decision;
  size(): number;
}

interface Bucket {
  tokens: number;
  last: number;
}

const EPS = 1e-9;

export function createLimiter(options: LimiterOptions): Limiter {
  const { capacity, refillPerSec, maxKeys, now } = options;
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity: целое ≥ 1');
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError('maxKeys: целое ≥ 1');
  if (!(refillPerSec > 0) || !Number.isFinite(refillPerSec)) throw new RangeError('refillPerSec > 0');
  const buckets = new Map<string, Bucket>();
  const msFor = (tokens: number) => (tokens <= EPS ? 0 : Math.ceil((tokens / refillPerSec) * 1000 - EPS));

  return {
    take(key, cost = 1) {
      if (!Number.isInteger(cost) || cost < 1) throw new RangeError('cost: целое ≥ 1');
      if (cost > capacity) throw new RangeError('cost больше ёмкости');
      const t = now();
      let b = buckets.get(key);
      if (b) {
        buckets.delete(key);
        const elapsed = Math.max(0, t - b.last);
        b.tokens = Math.min(capacity, b.tokens + (elapsed * refillPerSec) / 1000);
        b.last = Math.max(b.last, t);
      } else {
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
        b = { tokens: capacity, last: t };
      }
      buckets.set(key, b);
      const allowed = b.tokens + EPS >= cost;
      if (allowed) b.tokens = Math.max(0, b.tokens - cost);
      return {
        allowed,
        limit: capacity,
        remaining: Math.floor(b.tokens + EPS),
        retryAfterMs: allowed ? 0 : msFor(cost - b.tokens),
        resetMs: msFor(capacity - b.tokens),
      };
    },
    size: () => buckets.size,
  };
}
