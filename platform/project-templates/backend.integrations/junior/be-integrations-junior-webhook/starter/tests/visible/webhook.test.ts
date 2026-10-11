// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { createHmac } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp, sign } from '../../src/webhook';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000_000;

function post(app: ReturnType<typeof createApp>, raw: string, opts: { ts?: string; signature?: string } = {}) {
  const ts = opts.ts ?? String(NOW / 1000);
  const signature = opts.signature ?? 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
  return request(app)
    .post('/webhooks/payments')
    .set('content-type', 'application/json')
    .set('x-timestamp', ts)
    .set('x-signature', signature)
    .send(raw);
}

describe('webhook (visible)', () => {
  it('sign: формат sha256=<hex>', () => {
    expect(sign(SECRET, '1', '{}')).toBe('sha256=' + createHmac('sha256', SECRET).update('1.{}').digest('hex'));
  });

  it('верная подпись: событие обработано, повтор – duplicate', async () => {
    const seen: string[] = [];
    const app = createApp({ secret: SECRET, now: () => NOW, onEvent: (e) => void seen.push(e.id) });
    const raw = '{"id":"evt_1","type":"payment.succeeded","data":{"amount":100}}';
    const first = await post(app, raw);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'processed' });
    const again = await post(app, raw);
    expect(again.body).toEqual({ status: 'duplicate' });
    expect(seen).toEqual(['evt_1']);
  });

  it('неверная подпись – 401', async () => {
    const app = createApp({ secret: SECRET, now: () => NOW });
    const res = await post(app, '{"id":"e","type":"payment.failed"}', { signature: 'sha256=00' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_signature' });
  });

  it('устаревший timestamp – 401 stale_timestamp', async () => {
    const app = createApp({ secret: SECRET, now: () => NOW });
    const res = await post(app, '{"id":"e","type":"payment.failed"}', { ts: String(NOW / 1000 - 301) });
    expect(res.body).toEqual({ error: 'stale_timestamp' });
  });
});
