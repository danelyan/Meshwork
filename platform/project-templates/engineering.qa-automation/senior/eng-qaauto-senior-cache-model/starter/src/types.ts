// Типы контракта (contract.md). Менять не нужно.
export interface CacheOptions {
  capacity: number;
  ttlMs: number;
  now: () => number;
}

export interface Cache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  size(): number;
}

export type CacheFactory = (options: CacheOptions) => Cache;
