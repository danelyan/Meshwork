// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';

const order = { customerId: 'c-1', items: [{ sku: 'A', qty: 2, priceKop: 1500 }] };

describe('orders api (visible)', () => {
  it('POST /orders создаёт заказ и считает сумму', async () => {
    const res = await request(createApp()).post('/orders').set('Idempotency-Key', 'k-1').send(order);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ customerId: 'c-1', totalKop: 3000, status: 'new', version: 1 });
  });

  it('повтор с тем же ключом не создаёт второй заказ', async () => {
    const app = createApp();
    const a = await request(app).post('/orders').set('Idempotency-Key', 'k-1').send(order);
    const b = await request(app).post('/orders').set('Idempotency-Key', 'k-1').send(order);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
  });

  it('PATCH без If-Match – 428', async () => {
    const app = createApp();
    const a = await request(app).post('/orders').set('Idempotency-Key', 'k-2').send(order);
    const res = await request(app).patch(`/orders/${a.body.id}`).send({ status: 'paid' });
    expect(res.status).toBe(428);
  });
});
