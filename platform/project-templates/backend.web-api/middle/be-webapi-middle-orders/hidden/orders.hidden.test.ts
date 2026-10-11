// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

import { slowDb } from './helpers/slow-db';

const order = { customerId: 'c-1', items: [{ sku: 'A', qty: 2, priceKop: 1500 }, { sku: 'B', qty: 1, priceKop: 990 }] };
type App = ReturnType<typeof createApp>;
const create = (app: App, key: string, body: unknown = order) => request(app).post('/orders').set('Idempotency-Key', key).send(body as object);

async function seed(app: App, n: number, prefix = 'k') {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await create(app, `${prefix}-${i}`, { ...order, customerId: `c-${i}` })).body.id);
  return ids;
}

describe('создание и идемпотентность', () => {
  it('201: сумма, статус, версия, createdAt', async () => {
    const res = await create(createApp(slowDb()), 'a-1');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ customerId: 'c-1', totalKop: 3990, status: 'new', version: 1 });
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
  });

  it('без ключа или с плохим ключом – 400 idempotency_key_required', async () => {
    const app = createApp(slowDb());
    const a = await request(app).post('/orders').send(order);
    expect(a.status).toBe(400);
    expect(a.body).toEqual({ error: 'idempotency_key_required' });
    expect((await create(app, 'with space')).body).toEqual({ error: 'idempotency_key_required' });
    expect((await create(app, 'x'.repeat(65))).status).toBe(400);
  });

  it('повтор: тот же ответ, порядок ключей тела не важен, заголовок Idempotent-Replayed', async () => {
    const app = createApp(slowDb());
    const a = await create(app, 'r-1');
    const b = await create(app, 'r-1', { items: order.items, customerId: 'c-1' });
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(a.headers['idempotent-replayed']).toBeUndefined();
  });

  it('тот же ключ, другое тело – 422', async () => {
    const app = createApp(slowDb());
    await create(app, 'm-1');
    const res = await create(app, 'm-1', { ...order, customerId: 'c-2' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'idempotency_mismatch' });
  });

  it('одновременные повторы с одним ключом создают ровно один заказ', async () => {
    const app = createApp(slowDb());
    const res = await Promise.all(Array.from({ length: 6 }, () => create(app, 'race-1')));
    expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
    expect(res.every((r) => r.status === 201)).toBe(true);
    const list = await request(app).get('/orders');
    expect(list.body.items).toHaveLength(1);
  });

  it('400 validation: поля по алфавиту, позиция с ошибкой – items', async () => {
    const app = createApp(slowDb());
    const a = await create(app, 'v-1', { customerId: '', items: [{ sku: 'A', qty: 0, priceKop: 10 }] });
    expect(a.status).toBe(400);
    expect(a.body).toEqual({ error: 'validation', fields: ['customerId', 'items'] });
    expect((await create(app, 'v-2', { customerId: 'c', items: [] })).body.fields).toEqual(['items']);
    expect((await create(app, 'v-3', { customerId: 'c', items: [{ sku: 'A', qty: 1, priceKop: -1 }] })).body.fields).toEqual(['items']);
    expect((await create(app, 'v-4', { customerId: 'c', items: [{ sku: 'A', qty: 1.5, priceKop: 1 }] })).body.fields).toEqual(['items']);
    expect((await create(app, 'v-5', [1])).body).toEqual({ error: 'validation', fields: [] });
  });
});

describe('пагинация', () => {
  it('страницы без дублей и пропусков, nextCursor null на последней', async () => {
    const app = createApp(slowDb());
    const ids = await seed(app, 7);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: Record<string, string | number> = { limit: 3 };
      if (cursor) q.cursor = cursor;
      const res = await request(app).get('/orders').query(q);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((o: { id: string }) => o.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(ids);
    expect(pages).toBe(3);
  });

  it('вставка между страницами не ломает обход', async () => {
    const app = createApp(slowDb());
    const ids = await seed(app, 4);
    const p1 = await request(app).get('/orders').query({ limit: 2 });
    await seed(app, 2, 'late');
    const p2 = await request(app).get('/orders').query({ limit: 2, cursor: p1.body.nextCursor });
    expect([...p1.body.items, ...p2.body.items].map((o: { id: string }) => o.id)).toEqual(ids);
  });

  it('limit по умолчанию 20, вне 1…100 – 400; плохой курсор – 400 invalid_cursor', async () => {
    const app = createApp(slowDb());
    await seed(app, 22);
    const all = await request(app).get('/orders');
    expect(all.body.items).toHaveLength(20);
    expect(typeof all.body.nextCursor).toBe('string');
    for (const limit of [0, 101, 'abc']) {
      const r = await request(app).get('/orders').query({ limit });
      expect(r.status, String(limit)).toBe(400);
      expect(r.body).toEqual({ error: 'validation', fields: ['limit'] });
    }
    const bad = await request(app).get('/orders').query({ cursor: 'definitely-not-a-cursor' });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'invalid_cursor' });
  });

  it('фильтр по статусу', async () => {
    const app = createApp(slowDb());
    const [a] = await seed(app, 3);
    await request(app).patch(`/orders/${a}`).set('If-Match', '"1"').send({ status: 'paid' });
    const res = await request(app).get('/orders').query({ status: 'paid' });
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([a]);
  });
});

describe('версии и статусы', () => {
  it('GET отдаёт ETag; PATCH с верной версией – 200 и version+1; кавычки необязательны', async () => {
    const app = createApp(slowDb());
    const { body } = await create(app, 'e-1');
    const g = await request(app).get(`/orders/${body.id}`);
    expect(g.headers.etag).toBe('"1"');
    const p = await request(app).patch(`/orders/${body.id}`).set('If-Match', '"1"').send({ status: 'paid' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ status: 'paid', version: 2 });
    expect(p.headers.etag).toBe('"2"');
    const s = await request(app).patch(`/orders/${body.id}`).set('If-Match', '2').send({ status: 'shipped' });
    expect(s.body).toMatchObject({ status: 'shipped', version: 3 });
  });

  it('устаревшая версия – 412; без If-Match – 428', async () => {
    const app = createApp(slowDb());
    const { body } = await create(app, 'e-2');
    await request(app).patch(`/orders/${body.id}`).set('If-Match', '"1"').send({ status: 'paid' });
    const stale = await request(app).patch(`/orders/${body.id}`).set('If-Match', '"1"').send({ status: 'cancelled' });
    expect(stale.status).toBe(412);
    expect(stale.body).toEqual({ error: 'version_conflict' });
    const none = await request(app).patch(`/orders/${body.id}`).send({ status: 'cancelled' });
    expect(none.status).toBe(428);
    expect(none.body).toEqual({ error: 'precondition_required' });
  });

  it('одновременные PATCH с одной версией: ровно один успешен', async () => {
    const app = createApp(slowDb());
    const { body } = await create(app, 'e-3');
    const res = await Promise.all(['paid', 'cancelled', 'paid'].map((status) => request(app).patch(`/orders/${body.id}`).set('If-Match', '"1"').send({ status })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 412)).toHaveLength(2);
    expect((await request(app).get(`/orders/${body.id}`)).body.version).toBe(2);
  });

  it('недопустимый переход – 409 без смены версии; неизвестный статус – 400; неизвестный заказ – 404', async () => {
    const app = createApp(slowDb());
    const { body } = await create(app, 'e-4');
    const bad = await request(app).patch(`/orders/${body.id}`).set('If-Match', '"1"').send({ status: 'shipped' });
    expect(bad.status).toBe(409);
    expect(bad.body).toEqual({ error: 'invalid_transition' });
    expect((await request(app).get(`/orders/${body.id}`)).body.version).toBe(1);
    const unk = await request(app).patch(`/orders/${body.id}`).set('If-Match', '"1"').send({ status: 'lost' });
    expect(unk.status).toBe(400);
    expect(unk.body).toEqual({ error: 'validation', fields: ['status'] });
    expect((await request(app).get('/orders/nope')).status).toBe(404);
    expect((await request(app).get('/nothing')).body).toEqual({ error: 'not_found' });
  });
});
