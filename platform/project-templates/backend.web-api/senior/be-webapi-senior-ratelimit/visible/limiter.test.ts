// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import { createLimiter } from '../../src/limiter';

describe('лимитер (visible)', () => {
  it('новое ведро полное: первый запрос проходит', () => {
    const l = createLimiter({ capacity: 3, refillPerSec: 1, maxKeys: 10, now: () => 0 });
    expect(l.take('a')).toMatchObject({ allowed: true, limit: 3, remaining: 2, retryAfterMs: 0 });
  });

  it('после исчерпания — 429 с Retry-After', async () => {
    const app = createApp({ limiter: createLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 10, now: () => 0 }) });
    expect((await request(app).get('/api/items').set('X-Api-Key', 'k')).status).toBe(200);
    const res = await request(app).get('/api/items').set('X-Api-Key', 'k');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('1');
  });

  it('/health без лимита', async () => {
    const app = createApp({ limiter: createLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 10, now: () => 0 }) });
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
