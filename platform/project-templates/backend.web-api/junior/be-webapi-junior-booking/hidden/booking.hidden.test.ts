// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

const base = { clientName: 'Анна', specialistId: 'dr-1', startsAt: '2026-11-02T10:00:00Z', durationMin: 30 };
const post = (app: ReturnType<typeof createApp>, b: unknown) => request(app).post('/appointments').send(b as object);

describe('создание', () => {
  it('201: полная запись, startsAt нормализован в UTC, имя обрезано, JSON', async () => {
    const res = await post(createApp(), { ...base, clientName: '  Анна  ', startsAt: '2026-11-02T13:00:00+03:00' });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ clientName: 'Анна', specialistId: 'dr-1', startsAt: '2026-11-02T10:00:00.000Z', durationMin: 30, status: 'booked' });
  });

  it('id уникальны', async () => {
    const app = createApp();
    const a = await post(app, base);
    const b = await post(app, { ...base, startsAt: '2026-11-02T11:00:00Z' });
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('400: все неверные поля по алфавиту', async () => {
    const res = await post(createApp(), { clientName: '   ', specialistId: '', startsAt: 'завтра', durationMin: 20 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'validation', fields: ['clientName', 'durationMin', 'specialistId', 'startsAt'] });
  });

  it('400: длительность вне 15…240 или не целая', async () => {
    const app = createApp();
    for (const durationMin of [0, 255, 30.5, '30']) {
      const res = await post(app, { ...base, durationMin });
      expect(res.status, String(durationMin)).toBe(400);
      expect(res.body.fields).toEqual(['durationMin']);
    }
  });

  it('400: имя длиннее 100 символов; дата без часового пояса', async () => {
    const app = createApp();
    expect((await post(app, { ...base, clientName: 'а'.repeat(101) })).body.fields).toEqual(['clientName']);
    expect((await post(app, { ...base, startsAt: '2026-11-02T10:00:00' })).body.fields).toEqual(['startsAt']);
  });

  it('400: тело не JSON-объект', async () => {
    const app = createApp();
    const res = await request(app).post('/appointments').set('content-type', 'application/json').send('{broken');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'validation', fields: [] });
    const arr = await request(app).post('/appointments').send([1, 2]);
    expect(arr.status).toBe(400);
    expect(arr.body).toEqual({ error: 'validation', fields: [] });
  });
});

describe('слоты', () => {
  it('стык интервалов – не пересечение', async () => {
    const app = createApp();
    await post(app, base);
    expect((await post(app, { ...base, startsAt: '2026-11-02T10:30:00Z' })).status).toBe(201);
    expect((await post(app, { ...base, startsAt: '2026-11-02T09:30:00Z' })).status).toBe(201);
  });

  it('пересечение у другого специалиста допустимо; длинная запись перекрывает короткую', async () => {
    const app = createApp();
    await post(app, { ...base, startsAt: '2026-11-02T10:15:00Z', durationMin: 15 });
    expect((await post(app, { ...base, specialistId: 'dr-2' })).status).toBe(201);
    const res = await post(app, { ...base, startsAt: '2026-11-02T09:00:00Z', durationMin: 120 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'slot_taken' });
  });

  it('отмена освобождает слот', async () => {
    const app = createApp();
    const a = await post(app, base);
    const c = await request(app).post(`/appointments/${a.body.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('cancelled');
    expect((await post(app, base)).status).toBe(201);
  });
});

describe('чтение и отмена', () => {
  it('GET неизвестной записи и неизвестного пути – 404 not_found', async () => {
    const app = createApp();
    const a = await request(app).get('/appointments/nope');
    expect(a.status).toBe(404);
    expect(a.body).toEqual({ error: 'not_found' });
    const b = await request(app).get('/nothing/here');
    expect(b.status).toBe(404);
    expect(b.body).toEqual({ error: 'not_found' });
  });

  it('повторная отмена – 409 already_cancelled; отмена неизвестной – 404', async () => {
    const app = createApp();
    const a = await post(app, base);
    await request(app).post(`/appointments/${a.body.id}/cancel`);
    const again = await request(app).post(`/appointments/${a.body.id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'already_cancelled' });
    expect((await request(app).post('/appointments/nope/cancel')).status).toBe(404);
  });

  it('хранилище не общее между createApp()', async () => {
    const a = await post(createApp(), base);
    expect((await request(createApp()).get(`/appointments/${a.body.id}`)).status).toBe(404);
  });
});

describe('список', () => {
  it('по специалисту, по возрастанию начала, отменённые тоже', async () => {
    const app = createApp();
    const late = await post(app, { ...base, startsAt: '2026-11-02T15:00:00Z' });
    await post(app, { ...base, startsAt: '2026-11-02T09:00:00Z' });
    await post(app, { ...base, specialistId: 'dr-2' });
    await request(app).post(`/appointments/${late.body.id}/cancel`);
    const res = await request(app).get('/appointments').query({ specialistId: 'dr-1' });
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { startsAt: string }) => x.startsAt)).toEqual(['2026-11-02T09:00:00.000Z', '2026-11-02T15:00:00.000Z']);
    expect(res.body.items[1].status).toBe('cancelled');
  });

  it('фильтр по дате UTC', async () => {
    const app = createApp();
    await post(app, { ...base, startsAt: '2026-11-02T23:30:00Z' });
    await post(app, { ...base, startsAt: '2026-11-03T00:30:00+03:00' });
    const res = await request(app).get('/appointments').query({ specialistId: 'dr-1', date: '2026-11-02' });
    expect(res.body.items).toHaveLength(2);
    const next = await request(app).get('/appointments').query({ specialistId: 'dr-1', date: '2026-11-03' });
    expect(next.body.items).toHaveLength(0);
  });

  it('400 без specialistId и при неверной дате', async () => {
    const app = createApp();
    const a = await request(app).get('/appointments');
    expect(a.status).toBe(400);
    expect(a.body).toEqual({ error: 'validation', fields: ['specialistId'] });
    const b = await request(app).get('/appointments').query({ specialistId: 'dr-1', date: '02.11.2026' });
    expect(b.status).toBe(400);
    expect(b.body).toEqual({ error: 'validation', fields: ['date'] });
  });
});
