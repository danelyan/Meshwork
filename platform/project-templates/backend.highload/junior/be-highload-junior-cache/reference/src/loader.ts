// Эталон: cache-aside; ошибки источника в кеш не попадают.
import type { Cache } from './cache';

export interface CachedLoaderOptions<V> {
  cache: Cache<V>;
  load: (key: string) => Promise<V>;
}

export interface CachedLoader<V> {
  get(key: string): Promise<V>;
  invalidate(key: string): boolean;
  invalidatePrefix(prefix: string): number;
}

export function createCachedLoader<V>(options: CachedLoaderOptions<V>): CachedLoader<V> {
  const { cache, load } = options;
  return {
    async get(key) {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const value = await load(key);
      cache.set(key, value);
      return value;
    },
    invalidate: (key) => cache.delete(key),
    invalidatePrefix: (prefix) => cache.deleteByPrefix(prefix),
  };
}
