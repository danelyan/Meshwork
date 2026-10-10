// Лимитер по контракту (contract.md).
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

export function createLimiter(options: LimiterOptions): Limiter {
  void options;
  throw new Error('not implemented');
}
