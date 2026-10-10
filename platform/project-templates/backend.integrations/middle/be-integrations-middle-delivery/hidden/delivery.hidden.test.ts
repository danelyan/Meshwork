// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDeliveryClient } from '../src/delivery-client';

import { startMockProvider, type MockProvider } from './helpers/mock-provider';

let mock: MockProvider;
let sleeps: number[];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};
beforeEach(async () => {
  mock = await startMockProvider();
  sleeps = [];
});
afterEach(() => mock.close());

const QUOTE = { quote_id: 'q-1', price: { amount: '1234.50', currency: 'RUB' }, eta: { min_days: 1, max_days: 3 } };
const REQ = { fromCity: 'Москва', toCity: 'Казань', weightKg: 0.3335 };
const client = (extra: Record<string, unknown> = {}) => createDeliveryClient({ baseUrl: mock.baseUrl, sleep, backoffMs: 100, ...extra });

async function caught(p: Promise<unknown>): Promise<{ code?: string; status?: number; attempts?: number; name?: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string };
  }
  throw new Error('ожидалась ошибка');
}

describe('маппинг', () => {
  it('граммы округляются, JSON-заголовок, POST', async () => {
    mock.script('/v2/quotes', { status: 200, body: QUOTE });
    await client().quote(REQ);
    const r = mock.requests[0]!;
    expect(r.method).toBe('POST');
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body).toEqual({ from_city: 'Москва', to_city: 'Казань', weight_grams: 334 });
  });

  it('копейки без потери точности', async () => {
    for (const [amount, kop] of [['0.10', 10], ['19.99', 1999], ['1000', 100000], ['1234.5', 123450]] as const) {
      mock.script('/v2/quotes', { status: 200, body: { ...QUOTE, price: { amount, currency: 'RUB' } } });
      expect((await client().quote(REQ)).priceKop, amount).toBe(kop);
    }
  });

  it('невалидный ответ — invalid_response без повторов', async () => {
    const bad = [
      { ...QUOTE, price: { amount: '12,50', currency: 'RUB' } },
      { ...QUOTE, price: { amount: '1.234', currency: 'RUB' } },
      { ...QUOTE, price: { amount: '10.00', currency: 'USD' } },
      { ...QUOTE, eta: { min_days: 5, max_days: 2 } },
      { quote_id: 'q' },
    ];
    for (const body of bad) {
      mock.requests.length = 0;
      mock.script('/v2/quotes', { status: 200, body });
      const e = await caught(client().quote(REQ));
      expect(e.code, JSON.stringify(body)).toBe('invalid_response');
      expect(e.name).toBe('DeliveryError');
      expect(mock.requests).toHaveLength(1);
    }
  });

  it('shipment: статусы провайдера переводятся', async () => {
    mock.script('/v2/shipments', { status: 201, body: { shipment_id: 's-1', status: 'CREATED' } }, { status: 200, body: { shipment_id: 's-2', status: 'PENDING' } });
    expect(await client().createShipment({ quoteId: 'q-1', recipient: 'Иван' }, 'key-1')).toEqual({ shipmentId: 's-1', status: 'created' });
    expect(await client().createShipment({ quoteId: 'q-1', recipient: 'Иван' }, 'key-2')).toEqual({ shipmentId: 's-2', status: 'pending' });
    expect(mock.requests[0]!.body).toEqual({ quote_id: 'q-1', recipient: 'Иван' });
  });
});

describe('ретраи', () => {
  it('экспоненциальная пауза: 100, 200, 400', async () => {
    mock.script('/v2/quotes', { status: 500 }, { status: 502 }, { status: 503 }, { status: 200, body: QUOTE });
    await client().quote(REQ);
    expect(mock.requests).toHaveLength(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('Retry-After в секундах, с потолком 5000 мс', async () => {
    mock.script('/v2/quotes', { status: 429, headers: { 'retry-after': '2' } }, { status: 503, headers: { 'retry-after': '60' } }, { status: 200, body: QUOTE });
    await client().quote(REQ);
    expect(sleeps).toEqual([2000, 5000]);
  });

  it('попытки кончились — unavailable, attempts и status последнего ответа', async () => {
    mock.script('/v2/quotes', { status: 503 });
    const e = await caught(client({ maxRetries: 2 }).quote(REQ));
    expect(e).toMatchObject({ code: 'unavailable', attempts: 3, status: 503 });
    expect(mock.requests).toHaveLength(3);
  });

  it('4xx не повторяются: 400/422 — bad_request, 404 — not_found', async () => {
    for (const [status, code] of [[400, 'bad_request'], [422, 'bad_request'], [404, 'not_found']] as const) {
      mock.requests.length = 0;
      mock.script('/v2/quotes', { status, body: { error: 'x' } });
      const e = await caught(client().quote(REQ));
      expect(e, String(status)).toMatchObject({ code, status });
      expect(mock.requests).toHaveLength(1);
    }
  });

  it('таймаут попытки повторяется', async () => {
    mock.script('/v2/quotes', { status: 200, body: QUOTE, delayMs: 400 }, { status: 200, body: QUOTE });
    const started = Date.now();
    const q = await client({ timeoutMs: 60 }).quote(REQ);
    expect(q.priceKop).toBe(123450);
    expect(mock.requests).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(380);
  });

  it('обрыв соединения повторяется; все таймауты — unavailable', async () => {
    mock.script('/v2/quotes', { status: 0, destroy: true }, { status: 200, body: QUOTE });
    await expect(client().quote(REQ)).resolves.toMatchObject({ priceKop: 123450 });
    mock.requests.length = 0;
    mock.script('/v2/quotes', { status: 200, body: QUOTE, delayMs: 300 });
    const e = await caught(client({ timeoutMs: 40, maxRetries: 1 }).quote(REQ));
    expect(e).toMatchObject({ code: 'unavailable', attempts: 2 });
  });

  it('createShipment: один Idempotency-Key на все попытки', async () => {
    mock.script('/v2/shipments', { status: 500 }, { status: 429 }, { status: 201, body: { shipment_id: 's-9', status: 'CREATED' } });
    const s = await client().createShipment({ quoteId: 'q-1', recipient: 'Иван' }, 'idem-42');
    expect(s.shipmentId).toBe('s-9');
    expect(mock.requests.map((r) => r.headers['idempotency-key'])).toEqual(['idem-42', 'idem-42', 'idem-42']);
  });
});
