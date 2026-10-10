// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('notes api (visible)', () => {
  it('GET /health отвечает ok', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('POST /notes создаёт заметку', async () => {
    const res = await request(createApp()).post('/notes').send({ title: 'Первая', body: 'текст' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Первая', body: 'текст' });
    expect(typeof res.body.id).toBe('string');
  });

  it('GET /notes/:id возвращает созданную заметку', async () => {
    const app = createApp();
    const created = await request(app).post('/notes').send({ title: 'Вторая' });
    const res = await request(app).get(`/notes/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Вторая');
  });
});
