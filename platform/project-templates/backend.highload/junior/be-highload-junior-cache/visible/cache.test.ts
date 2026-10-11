// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { createCache } from '../../src/cache';
import { createCachedLoader } from '../../src/loader';

describe('кеш (visible)', () => {
  it('попадание и промах попадают в статистику', () => {
    const c = createCache<number>({ maxEntries: 5, ttlMs: 1000, now: () => 0 });
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
    expect(c.stats()).toMatchObject({ hits: 1, misses: 1, hitRate: 0.5 });
  });

  it('запись истекает ровно через ttl', () => {
    let t = 0;
    const c = createCache<number>({ maxEntries: 5, ttlMs: 1000, now: () => t });
    c.set('a', 1);
    t = 999;
    expect(c.get('a')).toBe(1);
    t = 1000;
    expect(c.get('a')).toBeUndefined();
  });

  it('вытесняет давно не использованное', () => {
    const c = createCache<number>({ maxEntries: 2, ttlMs: 1000, now: () => 0 });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
    expect(c.stats().evictions).toBe(1);
  });

  it('загрузчик ходит в источник один раз, пока запись жива', async () => {
    let calls = 0;
    const cache = createCache<string>({ maxEntries: 5, ttlMs: 1000, now: () => 0 });
    const loader = createCachedLoader({ cache, load: async (k: string) => (calls++, `v:${k}`) });
    expect(await loader.get('x')).toBe('v:x');
    expect(await loader.get('x')).toBe('v:x');
    expect(calls).toBe(1);
  });
});
