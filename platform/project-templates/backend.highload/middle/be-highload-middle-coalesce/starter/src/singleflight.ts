// Объединение одновременных вызовов по контракту (contract.md).
export interface Singleflight {
  do<T>(key: string, fn: () => Promise<T>): Promise<T>;
  inFlight(): number;
}

export function createSingleflight(): Singleflight {
  throw new Error('not implemented');
}
