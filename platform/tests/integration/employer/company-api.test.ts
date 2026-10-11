import { GET, PATCH } from '@/app/api/employer/company/route';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const OTHER = `cid=${signUserSession({ userId: 'u-other', role: 'employer', employerProfileId: 'p-other' })}`;
const CAND = `cid=${signUserSession({ userId: 'u-cand', role: 'candidate', candidateId: 'c-cand' })}`;
const PENDING = `cid=${signUserSession({ userId: 'u-pending', role: 'pending' })}`;

const patch = (body: unknown, cookie?: string, headers?: Record<string, string>) => {
  const req = jsonRequest('/api/employer/company', 'PATCH', body, cookie);
  for (const [k, v] of Object.entries(headers ?? {})) req.headers.set(k, v);
  return PATCH(req);
};
const get = (cookie?: string) => GET(jsonRequest('/api/employer/company', 'GET', undefined, cookie));

describe('профиль компании: /api/employer/company (БД)', () => {
  beforeAll(async () => {
    await resetDb();
  });
  beforeEach(async () => {
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await prisma.company.update({ where: { id: DEMO_EMPLOYER.companyId }, data: { description: 'Исходное', industry: null, inn: null, contact: null } });
    await prisma.company.upsert({ where: { id: 'co-other' }, update: { name: 'Другая' }, create: { id: 'co-other', name: 'Другая', isDemo: false } });
    for (const [id, role] of [['u-other', 'employer'], ['u-cand', 'candidate'], ['u-pending', 'pending']] as const) {
      await prisma.user.upsert({ where: { id }, update: {}, create: { id, name: id, role } });
    }
    await prisma.employerProfile.upsert({ where: { userId: 'u-other' }, update: {}, create: { id: 'p-other', userId: 'u-other', companyId: 'co-other' } });
  });
  afterAll(() => prisma.$disconnect());

  it('GET: своя компания; PATCH: частичная правка сохраняется, остальное не тронуто', async () => {
    const before = await (await get(EMP)).json();
    expect(before).toMatchObject({ id: DEMO_EMPLOYER.companyId, description: 'Исходное', inn: null });

    const res = await patch({ industry: 'Финтех', inn: '7707 083893', contact: 't.me/northflow' }, EMP);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: before.name, description: 'Исходное', industry: 'Финтех', inn: '7707083893', contact: '@northflow', inviteContact: '@northflow' });
    expect(await prisma.company.findUnique({ where: { id: DEMO_EMPLOYER.companyId }, select: { inn: true, industry: true } })).toEqual({ inn: '7707083893', industry: 'Финтех' });

    const cleared = await patch({ description: '' }, EMP);
    expect((await cleared.json()).description).toBeNull();
  });

  it('правит только свою компанию: чужая не меняется, даже если передать id', async () => {
    const res = await patch({ name: 'Новая чужая' }, OTHER);
    expect((await res.json()).id).toBe('co-other');
    expect((await prisma.company.findUniqueOrThrow({ where: { id: DEMO_EMPLOYER.companyId } })).name).not.toBe('Новая чужая');

    const withId = await patch({ id: 'co-other', name: 'Взлом' }, EMP);
    expect(withId.status).toBe(400);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: 'co-other' } })).name).toBe('Новая чужая');
  });

  it('Zod-отказ: 400 validation_failed с путями; ничего не записано', async () => {
    const res = await patch({ inn: '1234567890', name: 'A' }, EMP);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.code).toBe('validation_failed');
    expect(j.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['inn', 'name']);
    expect((await patch({}, EMP)).status).toBe(400);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: DEMO_EMPLOYER.companyId } })).inn).toBeNull();
  });

  it('401 без входа, 403 кандидату и pending, 403 на чужой Origin', async () => {
    expect((await get()).status).toBe(401);
    expect((await patch({ name: 'Хак' })).status).toBe(401);
    for (const c of [CAND, PENDING]) {
      expect((await get(c)).status).toBe(403);
      expect((await patch({ name: 'Хак' }, c)).status).toBe(403);
    }
    expect((await patch({ name: 'Хак' }, EMP, { origin: 'https://evil.example' })).status).toBe(403);
  });
});
