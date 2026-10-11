// Эталон: очередь ключей, нарезка на пачки в микрозадаче, пул слотов.
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

interface Waiter<V> {
  promise: Promise<V>;
  resolve: (v: V) => void;
  reject: (e: unknown) => void;
}

export function createBatcher<V>(options: BatcherOptions<V>): Batcher<V> {
  const { fetchMany, maxBatchSize, maxConcurrency } = options;
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) throw new RangeError('maxBatchSize: целое ≥ 1');
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new RangeError('maxConcurrency: целое ≥ 1');

  const entries = new Map<string, Waiter<V>>(); // все ключи, не завершённые: ждут или в полёте
  let collecting: string[] = []; // ключи, ещё не нарезанные на пачки
  let scheduled = false;
  const batches: string[][] = []; // готовые пачки в порядке создания
  let running = 0;

  const pump = () => {
    while (running < maxConcurrency && batches.length > 0) {
      const keys = batches.shift()!;
      running++;
      void run(keys);
    }
  };

  const run = async (keys: string[]) => {
    let result: Map<string, V> | undefined;
    let error: unknown;
    let failed = false;
    try {
      result = await fetchMany(keys);
    } catch (err) {
      failed = true;
      error = err;
    }
    for (const key of keys) {
      const w = entries.get(key)!;
      entries.delete(key);
      if (failed) w.reject(error);
      else if (result!.has(key)) w.resolve(result!.get(key) as V);
      else w.reject(new KeyNotFoundError(key));
    }
    running--;
    pump();
  };

  const flush = () => {
    scheduled = false;
    const keys = collecting;
    collecting = [];
    for (let i = 0; i < keys.length; i += maxBatchSize) batches.push(keys.slice(i, i + maxBatchSize));
    pump();
  };

  return {
    load(key) {
      const existing = entries.get(key);
      if (existing) return existing.promise;
      let resolve!: (v: V) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<V>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      entries.set(key, { promise, resolve, reject });
      collecting.push(key);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
      return promise;
    },
  };
}
