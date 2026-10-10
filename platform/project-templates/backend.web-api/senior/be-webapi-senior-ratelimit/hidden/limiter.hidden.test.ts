// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { createLimiter } from '../src/limiter';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), set: (v: number) => (t = v) };
}
const make = (o: Partial<{ capacity: number; refillPerSec: number; maxKeys: number }> = {}, c = clock()) => ({
  c,
  l: createLimiter({ capacity: 5, refillPerSec: 1, maxKeys: 100, ...o, now: c.now }),
});

describe('token bucket', () => {
  it('новое ведро полное: первый запрос проходит, limit и remaining', () => {
    const { l } = make();
    expect(l.take('a')).toEqual({ allowed: true, limit: 5, remaining: 4, retryAfterMs: 0, resetMs: 1000 });
  });

  it('исчерпание: отказ с retryAfterMs до одного токена, отказ не списывает токены', () => {
    const { l, c } = make();
    for (let i = 0; i < 5; i++) expect(l.take('a').allowed).toBe(true);
    const d = l.take('a');
    expect(d).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 1000, resetMs: 5000 });
    c.advance(999);
    expect(l.take('a').allowed).toBe(false);
    c.advance(1);
    expect(l.take('a')).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('дробное пополнение: 0.5 токена в секунду', () => {
    const { l, c } = make({ capacity: 1, refillPerSec: 0.5 });
    expect(l.take('a').allowed).toBe(true);
    c.advance(1000);
    expect(l.take('a')).toMatchObject({ allowed: false, retryAfterMs: 1000 });
    c.advance(1000);
    expect(l.take('a').allowed).toBe(true);
  });

  it('пополнение не выше ёмкости после долгого простоя', () => {
    const { l, c } = make();
    l.take('a', 3);
    c.advance(3_600_000);
    expect(l.take('a')).toMatchObject({ allowed: true, remaining: 4 });
  });

  it('стоимость: списывает cost; resetMs до полного ведра', () => {
    const { l } = make({ capacity: 10, refillPerSec: 2 });
    expect(l.take('a', 4)).toMatchObject({ allowed: true, remaining: 6, resetMs: 2000 });
    expect(l.take('a', 7)).toMatchObject({ allowed: false, remaining: 6, retryAfterMs: 500 });
  });

  it('неверная стоимость и стоимость больше ёмкости — RangeError', () => {
    const { l } = make();
    expect(() => l.take('a', 6)).toThrow(RangeError);
    expect(() => l.take('a', 0)).toThrow(RangeError);
    expect(() => l.take('a', 1.5)).toThrow(RangeError);
  });

  it('неверные параметры — RangeError', () => {
    const now = () => 0;
    expect(() => createLimiter({ capacity: 0, refillPerSec: 1, maxKeys: 1, now })).toThrow(RangeError);
    expect(() => createLimiter({ capacity: 2.5, refillPerSec: 1, maxKeys: 1, now })).toThrow(RangeError);
    expect(() => createLimiter({ capacity: 1, refillPerSec: 0, maxKeys: 1, now })).toThrow(RangeError);
    expect(() => createLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 0, now })).toThrow(RangeError);
  });

  it('часы назад: прошло 0 мс, без ошибок и без лишних токенов', () => {
    const { l, c } = make({ capacity: 2 });
    l.take('a', 2);
    c.advance(-10_000);
    expect(l.take('a').allowed).toBe(false);
    c.advance(10_000 + 999);
    expect(l.take('a').allowed).toBe(false);
    c.advance(1);
    expect(l.take('a').allowed).toBe(true);
  });

  it('ключи независимы', () => {
    const { l } = make({ capacity: 1 });
    expect(l.take('a').allowed).toBe(true);
    expect(l.take('a').allowed).toBe(false);
    expect(l.take('b').allowed).toBe(true);
  });
});

describe('память', () => {
  it('не больше maxKeys; вытесняется давно не использованный ключ (LRU)', () => {
    const { l } = make({ capacity: 1, maxKeys: 2 });
    l.take('a');
    l.take('b');
    l.take('a'); // a свежее b
    l.take('c'); // вытесняет b
    expect(l.size()).toBe(2);
    expect(l.take('a').allowed).toBe(false); // a не вытеснен: ведро пустое
    expect(l.take('b').allowed).toBe(true); // b вытеснен: новое полное ведро
  });

  it('100 000 ключей при maxKeys 10 000 — быстро (O(1) на запрос)', () => {
    const { l } = make({ maxKeys: 10_000 });
    const started = performance.now();
    for (let i = 0; i < 100_000; i++) l.take(`k${i}`);
    expect(l.size()).toBe(10_000);
    expect(performance.now() - started).toBeLessThan(2500);
  }, 30_000);
});

describe('HTTP', () => {
  const app = (o: Partial<{ capacity: number; refillPerSec: number }> = {}) => {
    const c = clock();
    return { c, app: createApp({ limiter: createLimiter({ capacity: 10, refillPerSec: 1, maxKeys: 100, ...o, now: c.now }) }) };
  };

  it('заголовки лимита на успешном ответе', async () => {
    const { app: a } = app();
    const res = await request(a).get('/api/items').set('X-Api-Key', 'k1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(res.headers['ratelimit-limit']).toBe('10');
    expect(res.headers['ratelimit-remaining']).toBe('9');
    expect(res.headers['ratelimit-reset']).toBe('1');
  });

  it('429: Retry-After в секундах, тело с retryAfterMs; токены отказа не списаны', async () => {
    const { app: a, c } = app({ capacity: 2, refillPerSec: 0.4 });
    await request(a).get('/api/items').set('X-Api-Key', 'k');
    await request(a).get('/api/items').set('X-Api-Key', 'k');
    const res = await request(a).get('/api/items').set('X-Api-Key', 'k');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited', retryAfterMs: 2500 });
    expect(res.headers['retry-after']).toBe('3');
    expect(res.headers['ratelimit-remaining']).toBe('0');
    c.advance(2500);
    expect((await request(a).get('/api/items').set('X-Api-Key', 'k')).status).toBe(200);
  });

  it('тяжёлый запрос стоит 5; стоимость больше ёмкости — 400', async () => {
    const { app: a } = app();
    expect((await request(a).post('/api/reports').set('X-Api-Key', 'r')).status).toBe(202);
    expect((await request(a).post('/api/reports').set('X-Api-Key', 'r')).body).toEqual({ queued: true });
    expect((await request(a).post('/api/reports').set('X-Api-Key', 'r')).status).toBe(429);
    const { app: small } = app({ capacity: 3 });
    const res = await request(small).post('/api/reports').set('X-Api-Key', 'r');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'cost_exceeds_capacity' });
  });

  it('без ключа — 401 без заголовков лимита; /health без лимита', async () => {
    const { app: a } = app({ capacity: 1 });
    const res = await request(a).get('/api/items');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'api_key_required' });
    expect(res.headers['ratelimit-limit']).toBeUndefined();
    for (let i = 0; i < 3; i++) {
      const h = await request(a).get('/health');
      expect(h.status).toBe(200);
      expect(h.headers['ratelimit-limit']).toBeUndefined();
    }
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    // new URL(…) в jsdom — URL из jsdom; путь считаем от файла теста.
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});
