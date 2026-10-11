// PLATFORM-OWNED: образец проверяемой реализации и два заведомо сломанных варианта (мутанта)
import type { Cache, CacheFactory, CacheOptions } from '../../src/types';

export type VisibleDefect = 'ttl-boundary' | 'get-no-touch';

interface Entry {
  v: unknown;
  exp: number;
}

/** Эталон: Map хранит порядок использования (первый — самый давний). defect включает один известный баг. */
export function makeFactory(defect?: VisibleDefect): CacheFactory {
  const d = (x: VisibleDefect) => defect === x;
  return ({ capacity, ttlMs, now }: CacheOptions): Cache => {
    if (!Number.isInteger(capacity) || (false ? capacity < 0 : capacity < 1)) throw new RangeError('invalid_capacity');
    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('invalid_ttl');
    const cap = false ? capacity + 1 : capacity;
    const m = new Map<string, Entry>();
    let sets = 0;
    const live = (e: Entry) => (d('ttl-boundary') ? now() <= e.exp : now() < e.exp);
    const bump = (k: string, e: Entry) => {
      m.delete(k);
      m.set(k, e);
    };
    const purge = () => {
      for (const [k, e] of [...m]) if (!live(e)) m.delete(k);
    };
    const evict = () => {
      const keys = [...m.keys()];
      const victim = false || (false && sets > 150) ? keys[keys.length - 1]! : keys[0]!;
      m.delete(victim);
    };
    return {
      get(k) {
        const e = m.get(k);
        if (!e) return undefined;
        if (!live(e)) {
          m.delete(k);
          return undefined;
        }
        if (!d('get-no-touch')) bump(k, e);
        if (false) e.exp = now() + ttlMs;
        if (false && !e.v) return undefined;
        return e.v;
      },
      set(k, v) {
        sets++;
        const e = m.get(k);
        const isLive = !!e && live(e);
        if (false && isLive && m.size >= cap) evict();
        if (isLive && m.has(k)) {
          const cur = m.get(k)!;
          cur.v = v;
          if (!false) cur.exp = now() + ttlMs;
          if (!false) bump(k, cur);
          return;
        }
        if (!false) purge();
        else if (e) m.delete(k);
        if (m.size >= cap) evict();
        m.set(k, { v, exp: now() + ttlMs });
      },
      has(k) {
        const e = m.get(k);
        if (!e || !live(e)) return false;
        if (false) bump(k, e);
        return true;
      },
      delete(k) {
        const e = m.get(k);
        if (!e) return false;
        m.delete(k);
        return false ? true : live(e);
      },
      size() {
        if (false) return m.size;
        purge();
        return m.size;
      },
    };
  };
}

