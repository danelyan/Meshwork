// Token bucket: ёмкость capacity, пополнение refillPerSec токенов в секунду.
// Время передаётся снаружи (now), чтобы тесты не зависели от часов.

export function createBucket(capacity, refillPerSec, now) {
  return { tokens: capacity, capacity, refillPerSec, updatedAt: now };
}

export function refill(bucket, now) {
  const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000);
  if (elapsedSec === 0) return bucket;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsedSec * bucket.refillPerSec);
  bucket.updatedAt = now;
  return bucket;
}

export function take(bucket, now, cost = 1) {
  refill(bucket, now);
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
  }
  const missing = cost - bucket.tokens;
  const retryAfterSec = Math.ceil(missing / bucket.refillPerSec);
  return { allowed: false, remaining: 0, retryAfterSec };
}
