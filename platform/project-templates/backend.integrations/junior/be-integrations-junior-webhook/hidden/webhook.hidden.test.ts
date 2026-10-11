// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { createHmac } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp, sign } from '../src/webhook';

const SECRET = 'whsec_hidden';
const NOW = 1_800_000_000_000;
const TS = String(NOW / 1000);
const hmac = (secret: string, ts: string, raw: string) => 'sha256=' + createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');

type App = ReturnType<typeof createApp>;
function post(app: App, raw: string, opts: { ts?: string; signature?: string; secret?: string; omit?: 'sig' | 'ts'; type?: string } = {}) {
  const ts = opts.ts ?? TS;
  let r = request(app).post('/webhooks/payments').set('content-type', opts.type ?? 'application/json');
  if (opts.omit !== 'ts') r = r.set('x-timestamp', ts);
  if (opts.omit !== 'sig') r = r.set('x-signature', opts.signature ?? hmac(opts.secret ?? SECRET, ts, raw));
  return r.send(raw);
}
const evt = (id: string, type = 'payment.succeeded', data: unknown = { amount: 1 }) => JSON.stringify({ id, type, data });
const make = (extra: Record<string, unknown> = {}) => createApp({ secret: SECRET, now: () => NOW, ...extra });

describe('sign', () => {
  it('HMAC-SHA256 от "<ts>.<тело>", префикс sha256=', () => {
    expect(sign(SECRET, TS, '{"a":1}')).toBe(hmac(SECRET, TS, '{"a":1}'));
    expect(sign('другой', TS, '{"a":1}')).not.toBe(sign(SECRET, TS, '{"a":1}'));
  });
});

describe('подпись', () => {
  it('подпись по сырым байтам: лишние пробелы, юникод, порядок ключей', async () => {
    const raw = '{ "type" : "payment.succeeded",\n  "id":"e-raw", "data": {"name":"Иван \\u00e9"} }';
    const res = await post(make(), raw);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
  });

  it('content-type не влияет на проверку', async () => {
    const res = await post(make(), evt('e-ct'), { type: 'text/plain' });
    expect(res.status).toBe(200);
  });

  it('нет заголовка подписи или времени — 401 invalid_signature', async () => {
    const app = make();
    for (const omit of ['sig', 'ts'] as const) {
      const res = await post(app, evt('e-miss'), { omit });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'invalid_signature' });
    }
    for (const ts of ['abc', '12.5', '']) {
      const res = await post(app, evt('e-ts'), { ts });
      expect(res.status, ts).toBe(401);
      expect(res.body).toEqual({ error: 'invalid_signature' });
    }
  });

  it('подпись с другим секретом, чужая длина и без префикса — 401, без падения', async () => {
    const app = make();
    const raw = evt('e-bad');
    for (const signature of [hmac('чужой', TS, raw), 'sha256=abc', 'abc', hmac(SECRET, TS, raw).slice(7), hmac(SECRET, TS, raw) + '00', '']) {
      const res = await post(app, raw, { signature });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'invalid_signature' });
    }
  });

  it('подпись подделана изменением тела или времени', async () => {
    const app = make();
    const raw = evt('e-tamper');
    const sig = hmac(SECRET, TS, raw);
    expect((await post(app, raw.replace('"amount":1', '"amount":9'), { signature: sig })).status).toBe(401);
    expect((await post(app, raw, { ts: String(NOW / 1000 + 1), signature: sig })).status).toBe(401);
  });
});

describe('окно времени', () => {
  it('ровно toleranceSec допустимо, на секунду больше — stale_timestamp (в обе стороны)', async () => {
    const app = make({ toleranceSec: 60 });
    expect((await post(app, evt('t-1'), { ts: String(NOW / 1000 - 60) })).status).toBe(200);
    expect((await post(app, evt('t-2'), { ts: String(NOW / 1000 + 60) })).status).toBe(200);
    for (const delta of [-61, 61]) {
      const res = await post(app, evt('t-3'), { ts: String(NOW / 1000 + delta) });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'stale_timestamp' });
    }
  });

  it('по умолчанию окно 300 с; время берётся из now()', async () => {
    const app = make();
    expect((await post(app, evt('d-1'), { ts: String(NOW / 1000 - 300) })).status).toBe(200);
    expect((await post(app, evt('d-2'), { ts: String(NOW / 1000 - 301) })).body).toEqual({ error: 'stale_timestamp' });
  });

  it('неверная подпись приоритетнее устаревшего времени', async () => {
    const res = await post(make(), evt('p-1'), { ts: '1000', signature: 'sha256=00' });
    expect(res.body).toEqual({ error: 'invalid_signature' });
  });
});

describe('разбор тела', () => {
  it('не JSON, не объект, нет id/type — 400 invalid_payload', async () => {
    const app = make();
    for (const raw of ['not json', '', '[1,2]', '"str"', '42', 'null', '{"type":"payment.failed"}', '{"id":"x"}', '{"id":"","type":"payment.failed"}', '{"id":1,"type":"payment.failed"}', '{"id":"x","type":5}']) {
      const res = await post(app, raw);
      expect(res.status, raw).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_payload' });
    }
  });

  it('неизвестный тип — ignored, обработчик не вызывается и id не запоминается', async () => {
    const seen: string[] = [];
    const app = make({ onEvent: (e: { type: string }) => void seen.push(e.type) });
    const res = await post(app, evt('u-1', 'customer.created'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ignored' });
    expect(seen).toEqual([]);
    expect((await post(app, evt('u-1', 'payment.failed'))).body).toEqual({ status: 'processed' });
    expect(seen).toEqual(['payment.failed']);
  });
});

describe('обработка и повторы', () => {
  it('onEvent получает { id, type, data } как пришло; все три типа принимаются', async () => {
    const got: unknown[] = [];
    const app = make({ onEvent: (e: unknown) => void got.push(e) });
    await post(app, evt('h-1', 'payment.succeeded', { amount: 100, nested: { a: [1, 2] } }));
    await post(app, evt('h-2', 'payment.failed', null));
    await post(app, evt('h-3', 'refund.created', 'x'));
    expect(got).toEqual([
      { id: 'h-1', type: 'payment.succeeded', data: { amount: 100, nested: { a: [1, 2] } } },
      { id: 'h-2', type: 'payment.failed', data: null },
      { id: 'h-3', type: 'refund.created', data: 'x' },
    ]);
  });

  it('асинхронный обработчик ждётся; повтор того же id — duplicate без вызова', async () => {
    let calls = 0;
    const app = make({
      onEvent: async () => {
        await new Promise((r) => setTimeout(r, 20));
        calls += 1;
      },
    });
    expect((await post(app, evt('a-1'))).body).toEqual({ status: 'processed' });
    expect(calls).toBe(1);
    const again = await post(app, evt('a-1', 'refund.created'));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ status: 'duplicate' });
    expect(calls).toBe(1);
  });

  it('сбой обработчика (sync и async) — 500, событие не запоминается, повтор обрабатывается', async () => {
    let attempt = 0;
    const app = make({
      onEvent: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('db down');
        if (attempt === 2) return Promise.reject(new Error('still down'));
      },
    });
    const raw = evt('f-1');
    for (let i = 0; i < 2; i += 1) {
      const res = await post(app, raw);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'handler_failed' });
    }
    expect((await post(app, raw)).body).toEqual({ status: 'processed' });
    expect(attempt).toBe(3);
    expect((await post(app, raw)).body).toEqual({ status: 'duplicate' });
  });

  it('без onEvent события принимаются; состояние независимо между createApp', async () => {
    const a = make();
    const b = make();
    expect((await post(a, evt('i-1'))).body).toEqual({ status: 'processed' });
    expect((await post(a, evt('i-1'))).body).toEqual({ status: 'duplicate' });
    expect((await post(b, evt('i-1'))).body).toEqual({ status: 'processed' });
  });
});
