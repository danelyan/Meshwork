// Загрузчик с кешем по контракту (contract.md).
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
  void options;
  throw new Error('not implemented');
}
