import type { CacheFactory } from './types';

// Ваша проверка кэша «LRU + TTL» (см. contract.md): бросьте Error, если реализация нарушает спецификацию.
export function verify(_createCache: CacheFactory): void {
  throw new Error('verify не реализован');
}
