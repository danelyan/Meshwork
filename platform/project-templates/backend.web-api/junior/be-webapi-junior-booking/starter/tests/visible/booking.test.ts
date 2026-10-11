// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';

const body = { clientName: 'Анна', specialistId: 'dr-1', startsAt: '2026-11-02T10:00:00Z', durationMin: 30 };

describe('booking api (visible)', () => {
  it('POST /appointments создаёт запись', async () => {
    const res = await request(createApp()).post('/appointments').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ clientName: 'Анна', specialistId: 'dr-1', startsAt: '2026-11-02T10:00:00.000Z', durationMin: 30, status: 'booked' });
    expect(typeof res.body.id).toBe('string');
  });

  it('GET /appointments/:id возвращает запись', async () => {
    const app = createApp();
    const created = await request(app).post('/appointments').send(body);
    const res = await request(app).get(`/appointments/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('пересечение слотов – 409', async () => {
    const app = createApp();
    await request(app).post('/appointments').send(body);
    const res = await request(app).post('/appointments').send({ ...body, clientName: 'Борис', startsAt: '2026-11-02T10:15:00Z' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'slot_taken' });
  });
});
