// Кэш запросов по контракту (contract.md): дедупликация, срок жизни, устаревшие ответы, подписки.
export type Status = 'idle' | 'loading' | 'success' | 'error';
export interface Snapshot {
  status: Status;
  data: unknown;
  error: unknown;
}
export interface QueryCacheOptions {
  fetcher: (key: string) => Promise<unknown>;
  ttlMs: number;
  now: () => number;
}
export interface QueryCache {
  fetch(key: string, opts?: { force?: boolean }): Promise<unknown>;
  peek(key: string): Snapshot;
  subscribe(key: string, listener: () => void): () => void;
  invalidate(key: string): void;
  subscriberCount(key: string): number;
}

const IDLE: Snapshot = { status: 'idle', data: undefined, error: undefined };

export function createQueryCache(options: QueryCacheOptions): QueryCache {
  void options;
  // TODO: записи по ключам, дедупликация запросов в полёте, свежесть по ttlMs, invalidate, подписки
  return {
    fetch: () => Promise.resolve(undefined),
    peek: () => IDLE,
    subscribe: () => () => {},
    invalidate: () => {},
    subscriberCount: () => 0,
  };
}
