import type { Cache, CacheFactory } from './types';

/** Генератор с фиксированным зерном (mulberry32): никакого Math.random. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fail(msg: string, trace: string[]): never {
  throw new Error(`${msg}\nпоследние операции:\n${trace.slice(-12).join('\n')}`);
}

/** Модель из спецификации: массив от самой давней к самой свежей записи. */
class Model {
  items: { k: string; v: unknown; until: number }[] = [];
  constructor(readonly cap: number, readonly ttl: number, readonly now: () => number) {}
  private alive() {
    const t = this.now();
    this.items = this.items.filter((i) => t < i.until);
  }
  private find(k: string) {
    return this.items.findIndex((i) => i.k === k);
  }
  get(k: string) {
    this.alive();
    const i = this.find(k);
    if (i < 0) return undefined;
    const [it] = this.items.splice(i, 1);
    this.items.push(it!);
    return it!.v;
  }
  set(k: string, v: unknown) {
    this.alive();
    const i = this.find(k);
    if (i >= 0) this.items.splice(i, 1);
    else if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ k, v, until: this.now() + this.ttl });
  }
  has(k: string) {
    this.alive();
    return this.find(k) >= 0;
  }
  delete(k: string) {
    this.alive();
    const i = this.find(k);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }
  size() {
    this.alive();
    return this.items.length;
  }
}

function expectRange(createCache: CacheFactory, opts: { capacity: number; ttlMs: number }, message: string) {
  try {
    createCache({ ...opts, now: () => 0 });
  } catch (e) {
    if (!(e instanceof RangeError) || e.message !== message) fail(`ожидался RangeError ${message}, получено ${String(e)}`, []);
    return;
  }
  fail(`createCache(${JSON.stringify(opts)}) должен бросать ${message}`, []);
}

const KEYS = ['a', 'b', 'c', 'd', 'e'];
const VALUES: unknown[] = [0, '', false, null, 1, 'x', 42, { z: 1 }];

function runSequence(createCache: CacheFactory, seed: number, capacity: number, ttlMs: number, steps: number) {
  const rand = rng(seed);
  let t = 1000;
  const now = () => t;
  const cache: Cache = createCache({ capacity, ttlMs, now });
  const model = new Model(capacity, ttlMs, now);
  const trace: string[] = [];
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  for (let i = 0; i < steps; i++) {
    const r = rand();
    // время: чаще стоит на месте, иногда шаг ровно в ttl или на единицу меньше/больше – граничные случаи
    if (r < 0.35) {
      t += pick([0, 1, ttlMs - 1, ttlMs, ttlMs + 1, Math.floor(ttlMs / 3), 2 * ttlMs]);
      trace.push(`t=${t}`);
    }
    const k = pick(KEYS);
    const op = rand();
    let got: unknown;
    let want: unknown;
    let label: string;
    if (op < 0.4) {
      const v = pick(VALUES);
      label = `set(${k}, ${JSON.stringify(v)})`;
      cache.set(k, v);
      model.set(k, v);
      got = want = undefined;
    } else if (op < 0.65) {
      label = `get(${k})`;
      got = cache.get(k);
      want = model.get(k);
    } else if (op < 0.8) {
      label = `has(${k})`;
      got = cache.has(k);
      want = model.has(k);
    } else if (op < 0.9) {
      label = `delete(${k})`;
      got = cache.delete(k);
      want = model.delete(k);
    } else {
      label = 'size()';
      got = cache.size();
      want = model.size();
    }
    trace.push(label);
    if (!Object.is(got, want) && JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`seed=${seed} шаг ${i}: ${label} вернул ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`, trace);
    }
    // инвариант после каждой операции: размер не больше capacity и совпадает с моделью
    const s = cache.size();
    if (s > capacity || s !== model.size()) fail(`seed=${seed} шаг ${i}: size()=${s}, ожидалось ${model.size()} (capacity ${capacity})`, trace);
  }
}

export function verify(createCache: CacheFactory): void {
  expectRange(createCache, { capacity: 0, ttlMs: 10 }, 'invalid_capacity');
  expectRange(createCache, { capacity: 1.5, ttlMs: 10 }, 'invalid_capacity');
  expectRange(createCache, { capacity: 2, ttlMs: 0 }, 'invalid_ttl');
  expectRange(createCache, { capacity: 2, ttlMs: Infinity }, 'invalid_ttl');
  // много коротких сценариев с разными ёмкостями и ttl + несколько длинных (дефекты, проявляющиеся после сотен операций)
  for (let seed = 1; seed <= 300; seed++) runSequence(createCache, seed, 1 + (seed % 4), 5 + (seed % 3) * 7, 60);
  for (let seed = 1001; seed <= 1006; seed++) runSequence(createCache, seed, 2 + (seed % 3), 20, 1500);
}
