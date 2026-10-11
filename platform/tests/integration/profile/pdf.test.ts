import { GET } from '@/app/api/profile/pdf/route';
import { proposeClaims } from '@/server/claims/service';
import type { VerifiedClaim } from '@/server/claims/types';
import { signSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const cookieOf = (id: string) => `cid=${signSession(id)}`;
const EMPLOYER = `cid=${signUserSession({ userId: 'u-emp', role: 'employer', employerProfileId: 'p-emp' })}`;
const PENDING = `cid=${signUserSession({ userId: 'u-pending', role: 'pending' })}`;
const get = (cookie?: string) => GET(jsonRequest('/api/profile/pdf', 'GET', undefined, cookie));

const verified: VerifiedClaim = {
  catalogId: 'be.cache',
  statement: 'Кэшировал данные',
  quote: 'Кэшировал справочники в Redis',
  sourceRef: 'cv.pdf#l4',
  confidence: 'high',
  level: 'self_reported',
  limits: 'Не доказывает: x',
  suggestedProof: ['interview:defend'],
  sourceKind: 'resume',
};

beforeEach(async () => {
  await resetDb();
  await prisma.candidate.createMany({
    data: [
      { id: 'owner', email: 'o@example.test', name: 'Владелец', specialization: 'backend' },
      { id: 'other', email: 'x@example.test', name: 'Чужой' },
    ],
  });
  // Аккаунты других ролей существуют в БД: иначе сессия считается устаревшей (401), а проверяем именно 403.
  await prisma.user.createMany({ data: [{ id: 'u-emp', name: 'Работодатель', role: 'employer' }, { id: 'u-pending', name: 'Новый', role: 'pending' }] });
  await prisma.company.create({ data: { id: 'co-emp', name: 'Компания', isDemo: false } });
  await prisma.employerProfile.create({ data: { id: 'p-emp', userId: 'u-emp', companyId: 'co-emp' } });
  await prisma.candidateProfile.create({ data: { candidateId: 'owner', city: 'Казань', experienceYears: 3, roles: ['Backend-разработчик'], stack: ['Go'] } });
  await prisma.candidateCategory.create({ data: { candidateId: 'owner', specialization: 'backend', grade: 'middle', confirmedAt: new Date('2026-10-05T10:00:00.000Z') } });
  await prisma.testAttempt.create({ data: { id: 'att-owner', candidateId: 'owner', specialization: 'backend', grade: 'middle', status: 'passed', policyVersion: 'adr-0002-v4', seed: 1, expiresAt: new Date('2026-10-05T10:30:00.000Z'), startedAt: new Date('2026-10-05T09:30:00.000Z'), finishedAt: new Date('2026-10-05T09:59:00.000Z') } });
  const rows = await proposeClaims('owner', [verified]);
  await prisma.claim.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'confirmed', confirmedAt: new Date() } });
});
afterAll(() => prisma.$disconnect());

describe('GET /api/profile/pdf (БД)', () => {
  it('без сессии и с поддельной кукой → 401', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('cid=owner.9999999999.forged')).status).toBe(401);
  });

  it('работодатель и pending → 403: PDF только для кандидата', async () => {
    expect((await get(EMPLOYER)).status).toBe(403);
    expect((await get(PENDING)).status).toBe(403);
  });

  it('свой профиль → PDF-файл: тип, attachment, тело начинается с %PDF-', async () => {
    const res = await get(cookieOf('owner'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="fsp-career-profile.pdf"');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1024);
    expect(Number(res.headers.get('content-length'))).toBe(body.length);
  });

  it('кандидат без анкеты, категории и утверждений тоже получает PDF (пустые состояния)', async () => {
    const res = await get(cookieOf('other'));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('кука с подписью, но без кандидата в БД → 401 session_stale, а не пустой файл', async () => {
    const res = await get(cookieOf('ghost'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).not.toBe('application/pdf');
  });
});
