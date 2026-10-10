// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются, запускаются только из каталога платформы
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('health', () => {
  it('GET /health → 200 {status: ok} в JSON', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('create note', () => {
  it('201 и полный объект, body по умолчанию пустой', async () => {
    const res = await request(createApp()).post('/notes').send({ title: 'Купить хлеб' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Купить хлеб', body: '' });
    expect(typeof res.body.id).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
  });

  it('title обрезается по краям', async () => {
    const res = await request(createApp()).post('/notes').send({ title: '  пробелы  ' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('пробелы');
  });

  it('id уникальны', async () => {
    const app = createApp();
    const a = await request(app).post('/notes').send({ title: 'a' });
    const b = await request(app).post('/notes').send({ title: 'b' });
    expect(a.body.id).not.toBe(b.body.id);
  });

  it.each([
    ['нет title', {}],
    ['title не строка', { title: 42 }],
    ['пустой title', { title: '   ' }],
    ['title длиннее 200', { title: 'x'.repeat(201) }],
  ])('400 validation: %s', async (_name, payload) => {
    const res = await request(createApp()).post('/notes').send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'validation' });
  });

  it('400 validation на тело не-JSON', async () => {
    const res = await request(createApp()).post('/notes').set('content-type', 'application/json').send('{broken');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'validation' });
  });
});

describe('get note', () => {
  it('200 — тот же объект, что вернул POST', async () => {
    const app = createApp();
    const created = await request(app).post('/notes').send({ title: 't', body: 'b' });
    const res = await request(app).get(`/notes/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  it('404 not_found для неизвестного id', async () => {
    const res = await request(createApp()).get('/notes/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('хранилище не общее между createApp()', async () => {
    const created = await request(createApp()).post('/notes').send({ title: 'одна' });
    const res = await request(createApp()).get(`/notes/${created.body.id}`);
    expect(res.status).toBe(404);
  });
});

describe('routing', () => {
  it('неизвестный путь → 404 not_found', async () => {
    const res = await request(createApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});
