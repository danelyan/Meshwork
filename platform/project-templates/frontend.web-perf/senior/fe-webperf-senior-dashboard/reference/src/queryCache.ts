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

interface Entry {
  snap: Snapshot;
  updatedAt: number | null;
  stale: boolean;
  dirty: boolean;
  gen: number;
  inflight: Promise<unknown> | null;
  listeners: Set<() => void>;
}

const IDLE: Snapshot = Object.freeze({ status: 'idle', data: undefined, error: undefined }) as Snapshot;

const same = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export function createQueryCache({ fetcher, ttlMs, now }: QueryCacheOptions): QueryCache {
  const entries = new Map<string, Entry>();

  const entry = (key: string): Entry => {
    let e = entries.get(key);
    if (!e) {
      e = { snap: IDLE, updatedAt: null, stale: false, dirty: false, gen: 0, inflight: null, listeners: new Set() };
      entries.set(key, e);
    }
    return e;
  };

  const set = (e: Entry, next: Snapshot) => {
    const cur = e.snap;
    if (cur.status === next.status && cur.data === next.data && cur.error === next.error) return;
    e.snap = next;
    for (const l of [...e.listeners]) l();
  };

  return {
    fetch(key, opts = {}) {
      const e = entry(key);
      if (e.inflight && !e.dirty) return e.inflight;
      if (!opts.force && !e.stale && e.updatedAt !== null && now() - e.updatedAt < ttlMs) {
        return Promise.resolve(e.snap.data);
      }
      const gen = ++e.gen;
      e.dirty = false;
      if (e.snap.status === 'idle' || (e.snap.status === 'error' && e.snap.data === undefined)) {
        set(e, { status: 'loading', data: undefined, error: undefined });
      }
      let raw: Promise<unknown>;
      try {
        raw = Promise.resolve(fetcher(key));
      } catch (err) {
        raw = Promise.reject(err);
      }
      const p = raw.then(
        (res) => {
          if (e.gen === gen) {
            const prev = e.snap.data;
            const data = prev !== undefined && same(prev, res) ? prev : res;
            e.stale = e.dirty;
            e.dirty = false;
            e.inflight = null;
            e.updatedAt = now();
            set(e, { status: 'success', data, error: undefined });
          }
          return res;
        },
        (err) => {
          if (e.gen === gen) {
            e.dirty = false;
            e.inflight = null;
            set(e, { status: 'error', data: e.snap.data, error: err });
          }
          throw err;
        },
      );
      e.inflight = p;
      return p;
    },
    peek: (key) => entries.get(key)?.snap ?? IDLE,
    subscribe(key, listener) {
      const e = entry(key);
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
      };
    },
    invalidate(key) {
      const e = entries.get(key);
      if (!e) return;
      if (e.inflight) e.dirty = true;
      if (e.updatedAt !== null) e.stale = true;
    },
    subscriberCount: (key) => entries.get(key)?.listeners.size ?? 0,
  };
}
