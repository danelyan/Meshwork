// Кеш по контракту (contract.md).
export interface CacheOptions {
  maxEntries: number;
  ttlMs: number;
  now: () => number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  hitRate: number;
}

export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  deleteByPrefix(prefix: string): number;
  clear(): void;
  size(): number;
  stats(): CacheStats;
}

export function createCache<V>(options: CacheOptions): Cache<V> {
  void options;
  throw new Error('not implemented');
}
