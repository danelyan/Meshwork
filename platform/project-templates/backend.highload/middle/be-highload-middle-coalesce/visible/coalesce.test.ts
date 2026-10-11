// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import { createBatcher } from '../../src/batcher';
import { createSingleflight } from '../../src/singleflight';

describe('singleflight (visible)', () => {
  it('одновременные вызовы одного ключа запускают fn один раз', async () => {
    const sf = createSingleflight();
    let calls = 0;
    const fn = async () => {
      calls++;
      return 42;
    };
    const results = await Promise.all([sf.do('k', fn), sf.do('k', fn), sf.do('k', fn)]);
    expect(results).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('ключ освобождается после завершения', async () => {
    const sf = createSingleflight();
    let calls = 0;
    await sf.do('k', async () => ++calls);
    await sf.do('k', async () => ++calls);
    expect(calls).toBe(2);
    expect(sf.inFlight()).toBe(0);
  });
});

describe('батчер (visible)', () => {
  it('синхронные load объединяются в одну пачку', async () => {
    const batches: string[][] = [];
    const b = createBatcher<number>({
      fetchMany: async (keys) => {
        batches.push(keys);
        return new Map(keys.map((k) => [k, k.length]));
      },
      maxBatchSize: 10,
      maxConcurrency: 2,
    });
    const r = await Promise.all([b.load('a'), b.load('bb'), b.load('a')]);
    expect(r).toEqual([1, 2, 1]);
    expect(batches).toEqual([['a', 'bb']]);
  });
});

describe('HTTP (visible)', () => {
  it('404 для ненайденного, 200 для найденного', async () => {
    const batcher = createBatcher({
      fetchMany: async (keys: string[]) => new Map(keys.filter((k) => k === 'a').map((k) => [k, { id: k, name: 'A' }])),
      maxBatchSize: 5,
      maxConcurrency: 1,
    });
    const app = createApp({ batcher });
    expect((await request(app).get('/items/a')).body).toEqual({ id: 'a', name: 'A' });
    expect((await request(app).get('/items/zzz')).status).toBe(404);
  });
});
