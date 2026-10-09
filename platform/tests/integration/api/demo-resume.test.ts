import { GET as listDemo } from '@/app/api/demo/login/route';
import { GET as resume } from '@/app/api/demo/resume/route';
import { resetEnvCache } from '@/server/env';
import { signSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const cookieOf = (id: string) => `cid=${signSession(id)}`;
const get = (path: string, id?: string) => jsonRequest(path, 'GET', undefined, id ? cookieOf(id) : undefined);

describe('api/demo/resume', () => {
  beforeEach(async () => {
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
    await resetDb();
    await prisma.candidate.createMany({
      data: [
        { id: 'demo-backend-strong', email: 'a@example.test', name: 'Дмитрий Рябинин', isDemo: true },
        { id: 'demo-unknown', email: 'b@example.test', name: 'Демо без резюме', isDemo: true },
        { id: 'real-c', email: 'c@example.test', name: 'Не демо', isDemo: false },
      ],
    });
  });
  afterEach(() => {
    delete process.env.DEMO_LOGIN;
    resetEnvCache();
  });
  afterAll(() => prisma.$disconnect());

  it('демо-кандидат получает свой PDF', async () => {
    const res = await resume(get('/api/demo/resume', 'demo-backend-strong'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(10_000);
  });

  it('?info=1 → имя файла и ссылка для вставки', async () => {
    const res = await resume(get('/api/demo/resume?info=1', 'demo-backend-strong'));
    expect(await res.json()).toEqual({ fileName: 'demo-1.pdf', link: 'https://github.com/demo-ryabinin' });
  });

  it('без сессии → 401; не-демо → 404; демо без резюме → 404', async () => {
    expect((await resume(get('/api/demo/resume'))).status).toBe(401);
    expect((await resume(get('/api/demo/resume', 'real-c'))).status).toBe(404);
    expect((await resume(get('/api/demo/resume', 'demo-unknown'))).status).toBe(404);
  });

  it('DEMO_LOGIN=false → 403', async () => {
    process.env.DEMO_LOGIN = 'false';
    resetEnvCache();
    expect((await resume(get('/api/demo/resume', 'demo-backend-strong'))).status).toBe(403);
  });

  it('список демо-кандидатов подсказывает файл и ссылку', async () => {
    const body = await (await listDemo()).json();
    const a = body.candidates.find((c: { id: string }) => c.id === 'demo-backend-strong');
    expect(a.demoResume).toEqual({ fileName: 'demo-1.pdf', link: 'https://github.com/demo-ryabinin' });
    expect(body.candidates.find((c: { id: string }) => c.id === 'demo-unknown').demoResume).toBeNull();
  });
});
