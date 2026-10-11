import request from 'supertest';

import type { CreateApp } from './types';

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export async function verify(createApp: CreateApp): Promise<void> {
  const app = createApp();
  const post = (body: unknown, key?: string) => {
    const r = request(app).post('/orders').send(body as object);
    return key ? r.set('Idempotency-Key', key) : r;
  };
  const make = async (sku = 'abc', qty = 1) => (await post({ sku, qty })).body as { id: string; status: string };

  // создание
  const created = await post({ sku: 'abc', qty: 3 });
  check(created.status === 201, `POST /orders: ожидался 201, получен ${created.status}`);
  check(created.body.sku === 'abc' && created.body.qty === 3 && created.body.status === 'new', 'POST /orders: неверное тело заказа');
  check(typeof created.body.id === 'string' && created.body.id, 'POST /orders: нет id');
  const second = await make();
  check(second.id !== created.body.id, 'id должны быть уникальны');

  // валидация: границы и типы
  for (const [qty, ok] of [[1, true], [10, true], [0, false], [11, false], [-1, false], [1.5, false], ['2', false], [null, false]] as const) {
    const r = await post({ sku: 'x', qty });
    check(r.status === (ok ? 201 : 400), `qty=${JSON.stringify(qty)}: ожидался ${ok ? 201 : 400}, получен ${r.status}`);
    if (!ok) check(r.body.error === 'validation' && r.body.field === 'qty', `qty=${JSON.stringify(qty)}: ожидалось validation/qty`);
  }
  for (const sku of ['', 5, null]) {
    const r = await post({ sku, qty: 1 });
    check(r.status === 400 && r.body.error === 'validation' && r.body.field === 'sku', `sku=${JSON.stringify(sku)}: ожидалось 400 validation/sku`);
  }
  const noBody = await request(app).post('/orders').set('Content-Type', 'application/json').send('{"sku": ');
  check(noBody.status === 400 && noBody.body.error === 'invalid_json', `битый JSON: ожидалось 400 invalid_json, получено ${noBody.status}`);

  // идемпотентность
  const a = await post({ sku: 'k', qty: 2 }, 'key-1');
  const b = await post({ sku: 'k', qty: 2 }, 'key-1');
  check(a.status === 201 && b.status === 200 && b.body.id === a.body.id, 'повтор с тем же ключом и телом: ожидался 200 и тот же заказ');
  const c = await post({ sku: 'k', qty: 3 }, 'key-1');
  check(c.status === 409 && c.body.error === 'idempotency_conflict', `тот же ключ, другое тело: ожидался 409, получен ${c.status}`);
  const bad = await post({ sku: '', qty: 2 }, 'key-2');
  check(bad.status === 400, 'невалидный запрос с ключом: 400');
  const afterBad = await post({ sku: 'ok', qty: 2 }, 'key-2');
  check(afterBad.status === 201, 'невалидный запрос не запоминает ключ');
  const totalBefore = (await request(app).get('/orders').query({ limit: 50 })).body.total;
  await post({ sku: 'k', qty: 2 }, 'key-1');
  check((await request(app).get('/orders').query({ limit: 50 })).body.total === totalBefore, 'повтор с ключом не должен создавать заказ');

  // чтение
  const got = await request(app).get(`/orders/${created.body.id}`);
  check(got.status === 200 && got.body.id === created.body.id, 'GET /orders/:id: 200');
  const miss = await request(app).get('/orders/nope');
  check(miss.status === 404 && miss.body.error === 'not_found', 'GET неизвестного id: 404 not_found');

  // переходы состояний
  const p = await make();
  const paid = await request(app).post(`/orders/${p.id}/pay`);
  check(paid.status === 200 && paid.body.status === 'paid', 'pay из new: 200 и paid');
  for (const act of ['pay', 'cancel']) {
    const r = await request(app).post(`/orders/${p.id}/${act}`);
    check(r.status === 409 && r.body.error === 'invalid_state', `${act} оплаченного: ожидался 409`);
  }
  const q = await make();
  const cancelled = await request(app).post(`/orders/${q.id}/cancel`);
  check(cancelled.status === 200 && cancelled.body.status === 'cancelled', 'cancel из new: 200 и cancelled');
  for (const act of ['pay', 'cancel']) {
    const r = await request(app).post(`/orders/${q.id}/${act}`);
    check(r.status === 409 && r.body.error === 'invalid_state', `${act} отменённого: ожидался 409`);
  }
  check((await request(app).get(`/orders/${q.id}`)).body.status === 'cancelled', 'отказ не меняет заказ');
  check((await request(app).post('/orders/nope/pay')).status === 404, 'pay неизвестного: 404');
  check((await request(app).post('/orders/nope/cancel')).status === 404, 'cancel неизвестного: 404');

  // список
  const fresh = createApp();
  for (let i = 0; i < 12; i++) await request(fresh).post('/orders').send({ sku: `s${i}`, qty: 1 });
  const ids = (await request(fresh).get('/orders').query({ limit: 50 })).body.items.map((o: { id: string }) => o.id);
  await request(fresh).post(`/orders/${ids[0]}/cancel`);
  await request(fresh).post(`/orders/${ids[1]}/pay`);
  const def = await request(fresh).get('/orders');
  check(def.status === 200 && def.body.items.length === 10 && def.body.total === 12, 'список: по умолчанию limit 10, total – всего');
  const page = await request(fresh).get('/orders').query({ limit: 5, offset: 8 });
  check(page.body.items.length === 4 && page.body.total === 12, 'список: offset/limit, total до пагинации');
  check(page.body.items.map((o: { id: string }) => o.id).join() === ids.slice(8).join(), 'список: порядок создания');
  const canc = await request(fresh).get('/orders').query({ status: 'cancelled' });
  check(canc.body.total === 1 && canc.body.items.length === 1 && canc.body.items[0].id === ids[0], 'фильтр status=cancelled');
  const newOnes = await request(fresh).get('/orders').query({ status: 'new', limit: 3 });
  check(newOnes.body.total === 10 && newOnes.body.items.length === 3, 'фильтр status=new + total до limit');
  for (const [param, value] of [['limit', 0], ['limit', 51], ['limit', 'x'], ['offset', -1], ['status', 'zzz']] as const) {
    const r = await request(fresh).get('/orders').query({ [param]: value });
    check(r.status === 400 && r.body.error === 'validation' && r.body.field === param, `${param}=${value}: ожидался 400 validation/${param}`);
  }
  check((await request(fresh).get('/orders').query({ limit: 50 })).status === 200, 'limit=50 допустим');

  // изоляция
  const other = createApp();
  const leak = await request(other).get('/orders');
  check(leak.body.total === 0 && leak.body.items.length === 0, 'новое приложение должно быть пустым');
}
