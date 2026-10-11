import { DELETE, GET as listDemo, POST as login } from '@/app/api/demo/login/route';
import { GET as health } from '@/app/api/health/route';
import { requireCandidate } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

describe('api/health', () => {
  afterAll(() => prisma.$disconnect());

  it('200 и db up', async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: 'up', llm: 'stub' });
  });
});

describe('api/demo/login', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.candidate.createMany({
      data: [
        { id: 'demo-a', email: 'demo-a@example.test', name: 'Демо А', isDemo: true },
        { id: 'real-b', email: 'real-b@example.test', name: 'Не демо', isDemo: false },
      ],
    });
  });

  it('GET – только демо-кандидаты', async () => {
    const res = await listDemo();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(['demo-a']);
  });

  it('POST демо-кандидата → подписанная кука, которую принимает requireCandidate', async () => {
    const res = await login(jsonRequest('/api/demo/login', 'POST', { candidateId: 'demo-a' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const cookie = cookieFrom(res);
    expect(cookie).toBeDefined();
    expect(requireCandidate(jsonRequest('/api/x', 'GET', undefined, cookie))).toBe('demo-a');
  });

  it('POST не-демо или несуществующего → 404; без тела → 400', async () => {
    expect((await login(jsonRequest('/api/demo/login', 'POST', { candidateId: 'real-b' }))).status).toBe(404);
    expect((await login(jsonRequest('/api/demo/login', 'POST', { candidateId: 'nope' }))).status).toBe(404);
    const bad = await login(jsonRequest('/api/demo/login', 'POST', {}));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('validation_failed');
  });

  it('DELETE стирает куку', async () => {
    const res = await DELETE();
    expect(res.headers.get('set-cookie')).toMatch(/cid=;.*Max-Age=0/i);
  });
});
