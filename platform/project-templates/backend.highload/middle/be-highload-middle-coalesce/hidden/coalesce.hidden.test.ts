// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp, type Item } from '../src/app';
import { createBatcher } from '../src/batcher';
import { createSingleflight } from '../src/singleflight';

const tick = () => new Promise<void>((r) => setImmediate(r));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Источник под ручным управлением: каждый вызов fetchMany ждёт, пока тест его завершит.
function manualSource<V>() {
  const calls: { keys: string[]; ok: (m: Map<string, V>) => void; fail: (e: unknown) => void }[] = [];
  let active = 0;
  let maxActive = 0;
  const fetchMany = (keys: string[]) => {
    const d = deferred<Map<string, V>>();
    active++;
    maxActive = Math.max(maxActive, active);
    calls.push({
      keys: [...keys],
      ok: (m) => {
        active--;
        d.resolve(m);
      },
      fail: (e) => {
        active--;
        d.reject(e);
      },
    });
    return d.promise;
  };
  return { calls, fetchMany, maxActive: () => maxActive };
}

const settle = <T>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

describe('singleflight', () => {
  it('одновременные вызовы одного ключа: fn один раз, результат тот же объект', async () => {
    const sf = createSingleflight();
    const d = deferred<{ n: number }>();
    let calls = 0;
    const a = sf.do('k', () => (calls++, d.promise));
    const b = sf.do('k', () => (calls++, Promise.resolve({ n: -1 })));
    const c = sf.do('k', () => (calls++, Promise.resolve({ n: -2 })));
    expect(calls).toBe(1);
    expect(sf.inFlight()).toBe(1);
    const value = { n: 7 };
    d.resolve(value);
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(value);
    expect(rb).toBe(value);
    expect(rc).toBe(value);
    expect(sf.inFlight()).toBe(0);
  });

  it('отказ разделяется между всеми ожидающими и не запоминается', async () => {
    const sf = createSingleflight();
    const d = deferred<number>();
    const a = settle(sf.do('k', () => d.promise));
    const b = settle(sf.do('k', async () => 1));
    const err = new Error('boom');
    d.reject(err);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toMatchObject({ ok: false });
    expect(ra.ok === false && ra.error).toBe(err);
    expect(rb.ok === false && rb.error).toBe(err);
    expect(sf.inFlight()).toBe(0);
    expect(await sf.do('k', async () => 5)).toBe(5);
  });

  it('синхронное исключение fn — отклонённый промис, ключ свободен', async () => {
    const sf = createSingleflight();
    const err = new Error('sync');
    const r = await settle(
      sf.do('k', (() => {
        throw err;
      }) as () => Promise<number>),
    );
    expect(r.ok === false && r.error).toBe(err);
    expect(sf.inFlight()).toBe(0);
    expect(await sf.do('k', async () => 9)).toBe(9);
  });

  it('разные ключи независимы; после завершения fn вызывается снова', async () => {
    const sf = createSingleflight();
    const da = deferred<string>();
    const db = deferred<string>();
    let calls = 0;
    const a = sf.do('a', () => (calls++, da.promise));
    const b = sf.do('b', () => (calls++, db.promise));
    expect(calls).toBe(2);
    expect(sf.inFlight()).toBe(2);
    db.resolve('B');
    expect(await b).toBe('B');
    expect(sf.inFlight()).toBe(1);
    da.resolve('A');
    expect(await a).toBe('A');
    expect(await sf.do('a', async () => (calls++, 'A2'))).toBe('A2');
    expect(calls).toBe(3);
  });
});

describe('батчер', () => {
  const make = (o: { maxBatchSize?: number; maxConcurrency?: number } = {}) => {
    const src = manualSource<number>();
    const batcher = createBatcher<number>({ fetchMany: src.fetchMany, maxBatchSize: 100, maxConcurrency: 10, ...o });
    return { src, batcher };
  };

  it('неверные параметры — RangeError', () => {
    const fetchMany = async () => new Map<string, number>();
    expect(() => createBatcher({ fetchMany, maxBatchSize: 0, maxConcurrency: 1 })).toThrow(RangeError);
    expect(() => createBatcher({ fetchMany, maxBatchSize: 1, maxConcurrency: 0 })).toThrow(RangeError);
    expect(() => createBatcher({ fetchMany, maxBatchSize: 1.5, maxConcurrency: 1 })).toThrow(RangeError);
  });

  it('синхронные load — одна пачка, ключи в порядке запроса, каждому своё значение', async () => {
    const { src, batcher } = make();
    const ps = ['c', 'a', 'b'].map((k) => batcher.load(k));
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['c', 'a', 'b']]);
    src.calls[0]!.ok(new Map([['a', 1], ['b', 2], ['c', 3]]));
    expect(await Promise.all(ps)).toEqual([3, 1, 2]);
  });

  it('повтор ключа внутри пачки уходит в источник один раз', async () => {
    const { src, batcher } = make();
    const ps = [batcher.load('a'), batcher.load('b'), batcher.load('a'), batcher.load('a')];
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['a', 'b']]);
    src.calls[0]!.ok(new Map([['a', 1], ['b', 2]]));
    expect(await Promise.all(ps)).toEqual([1, 2, 1, 1]);
  });

  it('пачки не больше maxBatchSize', async () => {
    const { src, batcher } = make({ maxBatchSize: 2 });
    const ps = ['a', 'b', 'c', 'd', 'e'].map((k) => batcher.load(k));
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    for (const c of src.calls) c.ok(new Map(c.keys.map((k) => [k, k.charCodeAt(0)])));
    expect(await Promise.all(ps)).toEqual([97, 98, 99, 100, 101]);
  });

  it('одновременно не больше maxConcurrency вызовов, очередь стартует по мере освобождения', async () => {
    const { src, batcher } = make({ maxBatchSize: 1, maxConcurrency: 2 });
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5'];
    const ps = keys.map((k) => batcher.load(k));
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['k1'], ['k2']]);
    src.calls[1]!.ok(new Map([['k2', 2]]));
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['k1'], ['k2'], ['k3']]);
    src.calls[0]!.ok(new Map([['k1', 1]]));
    src.calls[2]!.ok(new Map([['k3', 3]]));
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['k1'], ['k2'], ['k3'], ['k4'], ['k5']]);
    src.calls[3]!.ok(new Map([['k4', 4]]));
    src.calls[4]!.ok(new Map([['k5', 5]]));
    expect(await Promise.all(ps)).toEqual([1, 2, 3, 4, 5]);
    expect(src.maxActive()).toBeLessThanOrEqual(2);
  });

  it('ключ, уже запрошенный и не завершённый, не уходит в источник повторно; после завершения — уходит', async () => {
    const { src, batcher } = make();
    const first = batcher.load('a');
    await tick();
    const second = batcher.load('a');
    await tick();
    expect(src.calls).toHaveLength(1);
    src.calls[0]!.ok(new Map([['a', 10]]));
    expect(await Promise.all([first, second])).toEqual([10, 10]);
    const third = batcher.load('a');
    await tick();
    expect(src.calls).toHaveLength(2);
    src.calls[1]!.ok(new Map([['a', 11]]));
    expect(await third).toBe(11);
  });

  it('ключ, ожидающий слот в очереди пачек, тоже объединяется', async () => {
    const { src, batcher } = make({ maxBatchSize: 1, maxConcurrency: 1 });
    const a = batcher.load('a');
    const b = batcher.load('b');
    await tick();
    const b2 = batcher.load('b');
    src.calls[0]!.ok(new Map([['a', 1]]));
    await tick();
    expect(src.calls.map((c) => c.keys)).toEqual([['a'], ['b']]);
    src.calls[1]!.ok(new Map([['b', 2]]));
    expect(await Promise.all([a, b, b2])).toEqual([1, 2, 2]);
  });

  it('ключа нет в ответе — KeyNotFoundError только у его ожидающих', async () => {
    const { src, batcher } = make();
    const ok = settle(batcher.load('a'));
    const gone1 = settle(batcher.load('gone'));
    const gone2 = settle(batcher.load('gone'));
    await tick();
    src.calls[0]!.ok(new Map([['a', 1]]));
    const [ra, g1, g2] = await Promise.all([ok, gone1, gone2]);
    expect(ra).toEqual({ ok: true, value: 1 });
    for (const g of [g1, g2]) {
      expect(g.ok).toBe(false);
      const e = (g as { error: Error & { key?: string } }).error;
      expect(e.name).toBe('KeyNotFoundError');
      expect(e.key).toBe('gone');
    }
  });

  it('отказ источника: все ожидающие пачки получают ту же ошибку, остальные пачки целы, слот свободен', async () => {
    const { src, batcher } = make({ maxBatchSize: 2, maxConcurrency: 1 });
    const [a, b, c] = ['a', 'b', 'c'].map((k) => settle(batcher.load(k)));
    await tick();
    const err = new Error('upstream down');
    src.calls[0]!.fail(err);
    await tick();
    expect(src.calls.map((x) => x.keys)).toEqual([['a', 'b'], ['c']]);
    src.calls[1]!.ok(new Map([['c', 3]]));
    const [ra, rb, rc] = await Promise.all([a!, b!, c!]);
    expect(ra.ok === false && ra.error).toBe(err);
    expect(rb.ok === false && rb.error).toBe(err);
    expect(rc).toEqual({ ok: true, value: 3 });
    const again = batcher.load('a');
    await tick();
    expect(src.calls).toHaveLength(3);
    src.calls[2]!.ok(new Map([['a', 1]]));
    expect(await again).toBe(1);
  });

  it('синхронное исключение fetchMany — тот же отказ, батчер продолжает работать', async () => {
    let n = 0;
    const err = new Error('sync');
    const batcher = createBatcher<number>({
      fetchMany: ((keys: string[]) => {
        if (n++ === 0) throw err;
        return Promise.resolve(new Map(keys.map((k) => [k, 1])));
      }) as (keys: string[]) => Promise<Map<string, number>>,
      maxBatchSize: 5,
      maxConcurrency: 1,
    });
    const r = await settle(batcher.load('a'));
    expect(r.ok === false && r.error).toBe(err);
    expect(await batcher.load('a')).toBe(1);
  });
});

describe('HTTP', () => {
  const db: Record<string, Item> = { a: { id: 'a', name: 'Alpha' }, b: { id: 'b', name: 'Beta' }, c: { id: 'c', name: 'Gamma' } };
  const build = (opts: { failOn?: string } = {}) => {
    const batches: string[][] = [];
    const batcher = createBatcher<Item>({
      fetchMany: async (keys) => {
        batches.push([...keys]);
        if (opts.failOn && keys.includes(opts.failOn)) throw new Error('down');
        return new Map(keys.filter((k) => db[k]).map((k) => [k, db[k]!]));
      },
      maxBatchSize: 50,
      maxConcurrency: 2,
    });
    return { app: createApp({ batcher }), batches };
  };

  it('GET /items/:id — 200, 404, 502', async () => {
    const ok = build();
    expect((await request(ok.app).get('/items/a')).body).toEqual(db.a);
    const nf = await request(ok.app).get('/items/nope');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: 'not_found' });
    const bad = await request(build({ failOn: 'a' }).app).get('/items/a');
    expect(bad.status).toBe(502);
    expect(bad.body).toEqual({ error: 'upstream_failed' });
  });

  it('GET /items?ids — порядок запроса, без повторов, missing отдельно, одна пачка в источник', async () => {
    const { app, batches } = build();
    const res = await request(app).get('/items?ids=c,x,a,c,,b,y');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [db.c, db.a, db.b], missing: ['x', 'y'] });
    expect(batches).toEqual([['c', 'x', 'a', 'b', 'y']]);
  });

  it('GET /items без ids или с пустыми — 400', async () => {
    const { app } = build();
    for (const url of ['/items', '/items?ids=', '/items?ids=,,']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body).toEqual({ error: 'ids_required' });
    }
  });

  it('ошибка источника по любому ключу — 502 на весь запрос', async () => {
    const { app } = build({ failOn: 'b' });
    const res = await request(app).get('/items?ids=a,b,c');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'upstream_failed' });
  });
});
