// Батчер обращений к источнику по контракту (contract.md).
export class KeyNotFoundError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`key not found: ${key}`);
    this.name = 'KeyNotFoundError';
    this.key = key;
  }
}

export interface BatcherOptions<V> {
  fetchMany: (keys: string[]) => Promise<Map<string, V>>;
  maxBatchSize: number;
  maxConcurrency: number;
}

export interface Batcher<V> {
  load(key: string): Promise<V>;
}

export function createBatcher<V>(options: BatcherOptions<V>): Batcher<V> {
  void options;
  throw new Error('not implemented');
}
