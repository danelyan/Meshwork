// PLATFORM-OWNED: эталон и мутанты скрытых тестов платформы; кандидату не выдаются
import type { Cache, CacheFactory, CacheOptions } from '../../src/types';

export type Defect =
  | 'ttl-boundary'
  | 'get-no-touch'
  | 'has-touches'
  | 'get-extends-ttl'
  | 'overwrite-keeps-ttl'
  | 'overwrite-no-touch'
  | 'evict-mru'
  | 'overwrite-evicts'
  | 'size-counts-expired'
  | 'no-purge-before-evict'
  | 'delete-expired-true'
  | 'capacity-plus-one'
  | 'falsy-value'
  | 'capacity-zero-ok'
  | 'late-evict-mru';

interface Entry {
  v: unknown;
  exp: number;
}

/** Эталон: Map хранит порядок использования (первый — самый давний). defect включает один известный баг. */
export function makeFactory(defect?: Defect): CacheFactory {
  const d = (x: Defect) => defect === x;
  return ({ capacity, ttlMs, now }: CacheOptions): Cache => {
    if (!Number.isInteger(capacity) || (d('capacity-zero-ok') ? capacity < 0 : capacity < 1)) throw new RangeError('invalid_capacity');
    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('invalid_ttl');
    const cap = d('capacity-plus-one') ? capacity + 1 : capacity;
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
      const victim = d('evict-mru') || (d('late-evict-mru') && sets > 150) ? keys[keys.length - 1]! : keys[0]!;
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
        if (d('get-extends-ttl')) e.exp = now() + ttlMs;
        if (d('falsy-value') && !e.v) return undefined;
        return e.v;
      },
      set(k, v) {
        sets++;
        const e = m.get(k);
        const isLive = !!e && live(e);
        if (d('overwrite-evicts') && isLive && m.size >= cap) evict();
        if (isLive && m.has(k)) {
          const cur = m.get(k)!;
          cur.v = v;
          if (!d('overwrite-keeps-ttl')) cur.exp = now() + ttlMs;
          if (!d('overwrite-no-touch')) bump(k, cur);
          return;
        }
        if (!d('no-purge-before-evict')) purge();
        else if (e) m.delete(k);
        if (m.size >= cap) evict();
        m.set(k, { v, exp: now() + ttlMs });
      },
      has(k) {
        const e = m.get(k);
        if (!e || !live(e)) return false;
        if (d('has-touches')) bump(k, e);
        return true;
      },
      delete(k) {
        const e = m.get(k);
        if (!e) return false;
        m.delete(k);
        return d('delete-expired-true') ? true : live(e);
      },
      size() {
        if (d('size-counts-expired')) return m.size;
        purge();
        return m.size;
      },
    };
  };
}

/** Независимо написанная правильная реализация (массив и линейный поиск вместо Map): ведёт себя так же. */
export const altFactory: CacheFactory = ({ capacity, ttlMs, now }) => {
  if (typeof capacity !== 'number' || capacity % 1 !== 0 || !(capacity >= 1)) throw new RangeError('invalid_capacity');
  if (typeof ttlMs !== 'number' || !(ttlMs > 0) || ttlMs === Infinity) throw new RangeError('invalid_ttl');
  let items: { k: string; v: unknown; until: number }[] = []; // от самой давней к самой свежей
  const alive = () => {
    const t = now();
    items = items.filter((i) => i.until > t);
  };
  const idx = (k: string) => items.findIndex((i) => i.k === k);
  return {
    get(k) {
      alive();
      const i = idx(k);
      if (i < 0) return undefined;
      const [it] = items.splice(i, 1);
      items.push(it!);
      return it!.v;
    },
    set(k, v) {
      alive();
      const i = idx(k);
      if (i >= 0) items.splice(i, 1);
      else if (items.length >= capacity) items.shift();
      items.push({ k, v, until: now() + ttlMs });
    },
    has(k) {
      alive();
      return idx(k) >= 0;
    },
    delete(k) {
      alive();
      const i = idx(k);
      if (i < 0) return false;
      items.splice(i, 1);
      return true;
    },
    size() {
      alive();
      return items.length;
    },
  };
};
