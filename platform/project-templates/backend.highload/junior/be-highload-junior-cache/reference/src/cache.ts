// Эталон: Map хранит порядок использования (первый ключ — самый давний).
export interface CacheOptions {
  maxEntries: number;
  ttlMs: number;
  now: () => number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  hitRate: number;
}

export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  deleteByPrefix(prefix: string): number;
  clear(): void;
  size(): number;
  stats(): CacheStats;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

const validTtl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function createCache<V>(options: CacheOptions): Cache<V> {
  const { maxEntries, ttlMs, now } = options;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries: целое ≥ 1');
  if (!validTtl(ttlMs)) throw new RangeError('ttlMs > 0');
  const map = new Map<string, Entry<V>>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let expirations = 0;
  const live = (e: Entry<V>) => now() < e.expiresAt;
  const liveCount = () => {
    let n = 0;
    for (const e of map.values()) if (live(e)) n++;
    return n;
  };

  return {
    get(key) {
      const e = map.get(key);
      if (!e) {
        misses++;
        return undefined;
      }
      if (!live(e)) {
        map.delete(key);
        expirations++;
        misses++;
        return undefined;
      }
      hits++;
      map.delete(key);
      map.set(key, e);
      return e.value;
    },
    set(key, value, ttl) {
      if (value === undefined) throw new TypeError('value не может быть undefined');
      if (ttl !== undefined && !validTtl(ttl)) throw new RangeError('ttlMs > 0');
      if (map.has(key)) {
        map.delete(key);
      } else if (map.size >= maxEntries) {
        for (const [k, e] of [...map]) {
          if (!live(e)) {
            map.delete(k);
            expirations++;
          }
        }
        if (map.size >= maxEntries) {
          map.delete(map.keys().next().value as string);
          evictions++;
        }
      }
      map.set(key, { value, expiresAt: now() + (ttl ?? ttlMs) });
    },
    has(key) {
      const e = map.get(key);
      return !!e && live(e);
    },
    delete(key) {
      const e = map.get(key);
      if (!e) return false;
      map.delete(key);
      return live(e);
    },
    deleteByPrefix(prefix) {
      let n = 0;
      for (const [k, e] of [...map]) {
        if (!k.startsWith(prefix)) continue;
        map.delete(k);
        if (live(e)) n++;
      }
      return n;
    },
    clear: () => map.clear(),
    size: liveCount,
    stats() {
      const total = hits + misses;
      return { hits, misses, evictions, expirations, size: liveCount(), hitRate: total === 0 ? 0 : hits / total };
    },
  };
}
