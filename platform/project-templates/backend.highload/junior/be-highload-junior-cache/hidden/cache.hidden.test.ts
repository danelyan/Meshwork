// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it } from 'vitest';

import { createCache } from '../src/cache';
import { createCachedLoader } from '../src/loader';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const make = (o: Partial<{ maxEntries: number; ttlMs: number }> = {}, c = clock()) => ({
  c,
  cache: createCache<unknown>({ maxEntries: 3, ttlMs: 1000, ...o, now: c.now }),
});

describe('параметры и значения', () => {
  it('неверные параметры — RangeError', () => {
    const now = () => 0;
    expect(() => createCache({ maxEntries: 0, ttlMs: 1, now })).toThrow(RangeError);
    expect(() => createCache({ maxEntries: 1.5, ttlMs: 1, now })).toThrow(RangeError);
    expect(() => createCache({ maxEntries: 1, ttlMs: 0, now })).toThrow(RangeError);
    expect(() => createCache({ maxEntries: 1, ttlMs: -5, now })).toThrow(RangeError);
    const { cache } = make();
    expect(() => cache.set('a', 1, 0)).toThrow(RangeError);
    expect(() => cache.set('a', 1, -1)).toThrow(RangeError);
  });

  it('значения 0, пустая строка, false, null — попадания; undefined запрещён', () => {
    const { cache } = make({ maxEntries: 10 });
    for (const [k, v] of [['z', 0], ['s', ''], ['f', false], ['n', null]] as const) {
      cache.set(k, v);
      expect(cache.get(k)).toBe(v);
    }
    expect(cache.stats()).toMatchObject({ hits: 4, misses: 0 });
    expect(() => cache.set('u', undefined)).toThrow(TypeError);
    expect(cache.has('u')).toBe(false);
  });
});

describe('TTL', () => {
  it('граница: до t+T жива, в t+T истекла, expirations считается один раз', () => {
    const { cache, c } = make();
    cache.set('a', 1);
    c.advance(999);
    expect(cache.get('a')).toBe(1);
    c.advance(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 2, expirations: 1 });
  });

  it('ttl записи заменяет общий; перезапись продлевает срок', () => {
    const { cache, c } = make();
    cache.set('short', 1, 100);
    cache.set('long', 2, 5000);
    cache.set('re', 3);
    c.advance(900);
    cache.set('re', 4);
    c.advance(200);
    expect(cache.has('short')).toBe(false);
    expect(cache.get('long')).toBe(2);
    expect(cache.get('re')).toBe(4);
  });

  it('has и size не удаляют истекшее и не меняют статистику', () => {
    const { cache, c } = make();
    cache.set('a', 1);
    cache.set('b', 2);
    c.advance(1000);
    expect(cache.has('a')).toBe(false);
    expect(cache.size()).toBe(0);
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 0, expirations: 0, size: 0 });
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats().expirations).toBe(1);
  });
});

describe('вытеснение', () => {
  it('LRU: get освежает запись, вытесняется самая давняя', () => {
    const { cache } = make();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');
    cache.set('d', 4);
    expect(cache.has('b')).toBe(false);
    expect([cache.has('a'), cache.has('c'), cache.has('d')]).toEqual([true, true, true]);
    expect(cache.stats()).toMatchObject({ evictions: 1, size: 3 });
  });

  it('has не освежает запись', () => {
    const { cache } = make({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.has('a')).toBe(true);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
  });

  it('перезапись при полном кеше ничего не вытесняет и освежает ключ', () => {
    const { cache } = make({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    expect(cache.stats().evictions).toBe(0);
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(10);
  });

  it('перед вытеснением удаляются все истекшие, живые остаются', () => {
    const { cache, c } = make();
    cache.set('old1', 1, 100);
    cache.set('old2', 2, 100);
    cache.set('live', 3, 5000);
    c.advance(200);
    cache.set('new', 4);
    expect(cache.stats()).toMatchObject({ evictions: 0, expirations: 2, size: 2 });
    expect(cache.get('live')).toBe(3);
    expect(cache.get('new')).toBe(4);
  });
});

describe('удаление', () => {
  it('delete: true для живой, false для отсутствующей и истекшей; статистика не меняется', () => {
    const { cache, c } = make();
    cache.set('a', 1);
    cache.set('b', 2, 10);
    c.advance(50);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.delete('b')).toBe(false);
    expect(cache.delete('nope')).toBe(false);
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 0, expirations: 0, evictions: 0 });
  });

  it('deleteByPrefix возвращает число живых; clear не обнуляет счётчики', () => {
    const { cache, c } = make({ maxEntries: 10 });
    cache.set('user:1', 1);
    cache.set('user:2', 2);
    cache.set('user:3', 3, 10);
    cache.set('order:1', 4);
    c.advance(50);
    expect(cache.deleteByPrefix('user:')).toBe(2);
    expect(cache.has('order:1')).toBe(true);
    cache.get('order:1');
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.stats().hits).toBe(1);
  });
});

describe('загрузчик', () => {
  const setup = () => {
    const c = clock();
    const calls: string[] = [];
    let fail = false;
    const cache = createCache<string>({ maxEntries: 5, ttlMs: 1000, now: c.now });
    const loader = createCachedLoader({
      cache,
      load: async (k: string) => {
        calls.push(k);
        if (fail) throw new Error('boom');
        return `v${calls.length}:${k}`;
      },
    });
    return { c, calls, cache, loader, failNext: (v: boolean) => (fail = v) };
  };

  it('промах грузит и кладёт в кеш, повтор — попадание без вызова источника', async () => {
    const { loader, calls, cache } = setup();
    expect(await loader.get('a')).toBe('v1:a');
    expect(await loader.get('a')).toBe('v1:a');
    expect(calls).toEqual(['a']);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('после истечения ttl идёт в источник заново', async () => {
    const { loader, calls, c } = setup();
    await loader.get('a');
    c.advance(1000);
    expect(await loader.get('a')).toBe('v2:a');
    expect(calls).toEqual(['a', 'a']);
  });

  it('ошибка источника доходит до вызывающего и не кешируется', async () => {
    const { loader, calls, cache, failNext } = setup();
    failNext(true);
    await expect(loader.get('a')).rejects.toThrow('boom');
    expect(cache.has('a')).toBe(false);
    failNext(false);
    expect(await loader.get('a')).toBe('v2:a');
    expect(calls).toEqual(['a', 'a']);
  });

  it('синхронное исключение источника — тоже отказ get', async () => {
    const cache = createCache<string>({ maxEntries: 5, ttlMs: 1000, now: () => 0 });
    const loader = createCachedLoader({
      cache,
      load: (() => {
        throw new Error('sync');
      }) as (k: string) => Promise<string>,
    });
    await expect(loader.get('a')).rejects.toThrow('sync');
    expect(cache.size()).toBe(0);
  });

  it('invalidate и invalidatePrefix заставляют перечитать источник', async () => {
    const { loader, calls } = setup();
    await loader.get('user:1');
    await loader.get('user:2');
    await loader.get('order:1');
    expect(loader.invalidate('user:1')).toBe(true);
    expect(loader.invalidate('user:1')).toBe(false);
    expect(loader.invalidatePrefix('order:')).toBe(1);
    await loader.get('user:1');
    await loader.get('order:1');
    await loader.get('user:2');
    expect(calls).toEqual(['user:1', 'user:2', 'order:1', 'user:1', 'order:1']);
  });
});
