// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createOutbox, type OutboxOptions } from '../src/outbox';

import { clock, ev, partner, type Reply } from './helpers/partner';

function setup(script: Record<string, Reply[]> = {}, o: Partial<OutboxOptions> = {}) {
  const c = clock();
  const p = partner(script);
  const box = createOutbox({ send: p.send, now: c.now, maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000, breaker: { failureThreshold: 100, cooldownMs: 10_000 }, ...o });
  return { c, p, box };
}

describe('очередь и доставка', () => {
  it('2xx – доставлено; stats', async () => {
    const { p, box } = setup({ b: [{ status: 204 }] });
    box.enqueue(ev('a'));
    box.enqueue(ev('b'));
    await box.tick();
    expect(p.ids().sort()).toEqual(['a', 'b']);
    expect(box.stats()).toEqual({ pending: 0, delivered: 2, dead: 0, breaker: 'closed' });
  });

  it('дубликат id – false и не отправляется, в том числе после доставки', async () => {
    const { p, box } = setup();
    expect(box.enqueue(ev('a'))).toBe(true);
    expect(box.enqueue(ev('a'))).toBe(false);
    await box.tick();
    expect(box.enqueue(ev('a', 'other'))).toBe(false);
    await box.tick();
    expect(p.calls).toHaveLength(1);
  });

  it('порядок по ключу: следующее событие ключа – только после доставки предыдущего', async () => {
    const { p, box } = setup();
    box.enqueue(ev('k1', 'order-1'));
    box.enqueue(ev('k2', 'order-1'));
    box.enqueue(ev('m1', 'order-2'));
    await box.tick();
    expect(p.ids()).toEqual(['k1', 'm1']);
    await box.tick();
    expect(p.ids()).toEqual(['k1', 'm1', 'k2']);
  });

  it('head-of-line: пока первое событие ключа в ретраях, второе ждёт; другой ключ не ждёт', async () => {
    const { c, p, box } = setup({ k1: [{ status: 500 }] });
    box.enqueue(ev('k1', 'order-1'));
    box.enqueue(ev('k2', 'order-1'));
    box.enqueue(ev('m1', 'order-2'));
    await box.tick();
    c.advance(50);
    await box.tick();
    expect(p.ids()).toEqual(['k1', 'm1']);
    c.advance(50);
    await box.tick();
    await box.tick();
    expect(p.ids()).toEqual(['k1', 'm1', 'k1', 'k2']);
  });

  it('пул отправок: не больше concurrency одновременно, все готовые – за один tick', async () => {
    const { p, box } = setup({}, { concurrency: 3 });
    for (let i = 0; i < 10; i++) box.enqueue(ev(`e${i}`));
    await box.tick();
    expect(p.calls).toHaveLength(10);
    expect(p.maxInFlight()).toBe(3);
  });

  it('повторный tick() во время работы – тот же промис, без двойных отправок', async () => {
    const { p, box } = setup();
    for (let i = 0; i < 5; i++) box.enqueue(ev(`e${i}`));
    const a = box.tick();
    const b = box.tick();
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(p.calls).toHaveLength(5);
  });

  it('неверные параметры – RangeError', () => {
    const base = { send: async () => ({ status: 200 }), now: () => 0, maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, breaker: { failureThreshold: 3, cooldownMs: 10 } };
    expect(() => createOutbox({ ...base, maxAttempts: 0 })).toThrow(RangeError);
    expect(() => createOutbox({ ...base, maxDelayMs: 5 })).toThrow(RangeError);
    expect(() => createOutbox({ ...base, concurrency: 0 })).toThrow(RangeError);
    expect(() => createOutbox({ ...base, breaker: { failureThreshold: 0, cooldownMs: 10 } })).toThrow(RangeError);
  });
});

describe('ретраи', () => {
  it('экспоненциальная задержка с потолком; номер попытки передаётся в send', async () => {
    const { c, p, box } = setup({ a: [{ status: 500 }, { status: 502 }, 'throw', { status: 503 }] }, { maxDelayMs: 300 });
    box.enqueue(ev('a'));
    await box.tick(); // попытка 1 → +100
    await box.tick();
    c.advance(99);
    await box.tick();
    expect(p.calls).toHaveLength(1);
    c.advance(1);
    await box.tick(); // попытка 2 → +200
    c.advance(199);
    await box.tick();
    c.advance(1);
    await box.tick(); // попытка 3 → +min(300, 400)
    c.advance(299);
    await box.tick();
    expect(p.calls).toHaveLength(3);
    c.advance(1);
    await box.tick(); // попытка 4
    expect(p.calls.map((x) => x.attempt)).toEqual([1, 2, 3, 4]);
    expect(box.stats()).toMatchObject({ pending: 1, delivered: 0 });
  });

  it('в одном tick событие отправляется один раз даже при нулевой задержке', async () => {
    const { p, box } = setup({ a: [{ status: 500 }] }, { baseDelayMs: 0, maxDelayMs: 0 });
    box.enqueue(ev('a'));
    await box.tick();
    expect(p.calls).toHaveLength(1);
    await box.tick();
    expect(p.calls).toHaveLength(2);
    expect(box.stats().delivered).toBe(1);
  });

  it('временные ошибки: 5xx, 408, 429, исключение – повтор', async () => {
    const { p, box } = setup({ a: [{ status: 503 }], b: [{ status: 408 }], c: [{ status: 429 }], d: ['throw'] }, { baseDelayMs: 0, maxDelayMs: 0 });
    for (const id of ['a', 'b', 'c', 'd']) box.enqueue(ev(id));
    await box.tick();
    expect(box.stats()).toMatchObject({ pending: 4, dead: 0 });
    await box.tick();
    expect(p.calls).toHaveLength(8);
    expect(box.stats()).toMatchObject({ pending: 0, delivered: 4 });
  });

  it('постоянная ошибка – сразу dead letter http_<статус>; очередь ключа идёт дальше', async () => {
    const { p, box } = setup({ a: [{ status: 404 }], b: [{ status: 422 }] });
    box.enqueue(ev('a', 'k'));
    box.enqueue(ev('a2', 'k'));
    box.enqueue(ev('b'));
    await box.tick();
    await box.tick();
    expect(p.ids()).toEqual(['a', 'b', 'a2']);
    expect(box.deadLetters()).toEqual([
      { event: ev('a', 'k'), reason: 'http_404', attempts: 1 },
      { event: ev('b'), reason: 'http_422', attempts: 1 },
    ]);
    expect(box.stats()).toMatchObject({ pending: 0, delivered: 1, dead: 2 });
  });

  it('попытки исчерпаны – retries_exhausted', async () => {
    const { box } = setup({ a: [{ status: 500 }, { status: 500 }] }, { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 });
    box.enqueue(ev('a'));
    await box.tick();
    await box.tick();
    expect(box.deadLetters()).toEqual([{ event: ev('a'), reason: 'retries_exhausted', attempts: 2 }]);
    expect(box.stats().pending).toBe(0);
  });

  it('429 с retryAfterMs больше задержки – ждём сколько просит партнёр', async () => {
    const { c, p, box } = setup({ a: [{ status: 429, retryAfterMs: 5000 }] });
    box.enqueue(ev('a'));
    await box.tick();
    c.advance(4999);
    await box.tick();
    expect(p.calls).toHaveLength(1);
    c.advance(1);
    await box.tick();
    expect(p.calls).toHaveLength(2);
  });
});

describe('предохранитель', () => {
  const opts = { concurrency: 1, breaker: { failureThreshold: 3, cooldownMs: 10_000 } };

  it('открывается после N подряд временных ошибок: новые отправки не начинаются', async () => {
    const { c, p, box } = setup({ a: [{ status: 500 }], b: [{ status: 500 }], c: [{ status: 500 }] }, opts);
    for (const id of ['a', 'b', 'c', 'd']) box.enqueue(ev(id));
    await box.tick();
    expect(p.ids()).toEqual(['a', 'b', 'c']);
    expect(box.stats().breaker).toBe('open');
    c.advance(5000);
    await box.tick();
    expect(p.calls).toHaveLength(3);
  });

  it('half_open: ровно одна пробная отправка; успех закрывает', async () => {
    const { c, p, box } = setup({ a: [{ status: 500 }, { status: 200 }], b: [{ status: 500 }], c: [{ status: 500 }] }, opts);
    for (const id of ['a', 'b', 'c', 'd']) box.enqueue(ev(id));
    await box.tick();
    c.advance(10_000);
    expect(box.stats().breaker).toBe('half_open');
    await box.tick();
    expect(p.ids().slice(3)).toEqual(['a']);
    expect(box.stats().breaker).toBe('closed');
    await box.tick();
    expect(p.ids().slice(4).sort()).toEqual(['b', 'c', 'd']);
    expect(box.stats()).toMatchObject({ delivered: 4, pending: 0 });
  });

  it('half_open: временная ошибка пробы – снова open с новым отсчётом', async () => {
    const { c, p, box } = setup({ a: [{ status: 500 }, { status: 503 }], b: [{ status: 500 }], c: [{ status: 500 }] }, opts);
    for (const id of ['a', 'b', 'c']) box.enqueue(ev(id));
    await box.tick();
    c.advance(10_000);
    await box.tick();
    expect(box.stats().breaker).toBe('open');
    c.advance(9_999);
    await box.tick();
    expect(p.calls).toHaveLength(4);
    c.advance(1);
    await box.tick();
    expect(p.calls).toHaveLength(5);
    expect(p.calls[4]).toEqual({ id: 'a', attempt: 3 });
  });

  it('доставка сбрасывает счётчик подряд идущих ошибок', async () => {
    const { p, box } = setup({ a: [{ status: 500 }], b: [{ status: 500 }], d: [{ status: 500 }], e: [{ status: 500 }] }, opts);
    for (const id of ['a', 'b', 'c', 'd', 'e']) box.enqueue(ev(id));
    await box.tick();
    expect(p.calls).toHaveLength(5);
    expect(box.stats().breaker).toBe('closed');
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    // new URL(…) в jsdom – URL из jsdom; путь считаем от файла теста.
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
