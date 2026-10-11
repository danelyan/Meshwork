// Эталон: Map ключ → промис в полёте.
export interface Singleflight {
  do<T>(key: string, fn: () => Promise<T>): Promise<T>;
  inFlight(): number;
}

export function createSingleflight(): Singleflight {
  const flights = new Map<string, Promise<unknown>>();
  return {
    do<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = flights.get(key);
      if (existing) return existing as Promise<T>;
      let p: Promise<T>;
      try {
        p = Promise.resolve(fn());
      } catch (err) {
        return Promise.reject(err);
      }
      const tracked = p.finally(() => {
        if (flights.get(key) === tracked) flights.delete(key);
      });
      flights.set(key, tracked);
      return tracked;
    },
    inFlight: () => flights.size,
  };
}
