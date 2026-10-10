import { GET, PUT } from '@/app/api/favorites/route';
import { savedCandidateCards } from '@/server/favorites';
import { signUserSession } from '@/server/session';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const employer = { userId: 'fav-employer', role: 'employer' as const, candidateId: null, employerProfileId: 'fav-profile' };
const candidate = { userId: 'fav-user', role: 'candidate' as const, candidateId: 'fav-candidate', employerProfileId: null };
const other = { userId: 'fav-other', role: 'candidate' as const, candidateId: 'fav-other-candidate', employerProfileId: null };
const cookie = (owner: typeof candidate | typeof employer) => `cid=${signUserSession(owner)}`;
const get = (owner?: typeof candidate | typeof employer) => GET(jsonRequest('/api/favorites', 'GET', undefined, owner ? cookie(owner) : undefined));
const put = (owner: typeof candidate | typeof employer, body: unknown) => PUT(jsonRequest('/api/favorites', 'PUT', body, cookie(owner)));

describe('persistent favorites: own account and fresh privacy projection', () => {
  beforeAll(() => resetDb());
  beforeEach(async () => {
    await prisma.userSavedCandidate.deleteMany();
    await prisma.userSavedVacancy.deleteMany();
    await prisma.invitation.deleteMany();
    for (const [id, name] of [['fav-candidate', 'Секретное имя'], ['fav-other-candidate', 'Другой']] as const) {
      await prisma.candidate.upsert({ where: { id }, update: { hiddenFromEmployers: false }, create: { id, name, email: `${id}@example.org`, contact: '@private_contact', specialization: 'backend' } });
      await prisma.candidateCategory.deleteMany({ where: { candidateId: id } });
      await prisma.candidateCategory.create({ data: { candidateId: id, specialization: 'backend', grade: 'middle' } });
    }
    await prisma.company.upsert({ where: { id: 'fav-company' }, create: { id: 'fav-company', name: 'Компания' }, update: {} });
    for (const owner of [candidate, other, employer]) await prisma.user.upsert({ where: { id: owner.userId }, update: {}, create: { id: owner.userId, role: owner.role, name: owner.userId, candidateId: owner.candidateId } });
    await prisma.employerProfile.upsert({ where: { id: employer.employerProfileId }, update: {}, create: { id: employer.employerProfileId, userId: employer.userId, companyId: 'fav-company' } });
    await prisma.vacancy.upsert({ where: { id: 'fav-vacancy' }, update: { archivedAt: null }, create: { id: 'fav-vacancy', companyId: 'fav-company', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 100000, salaryTo: 200000, needs: [] } });
  });
  afterAll(() => prisma.$disconnect());

  it('persists candidate favorites, idempotently saves, isolates accounts and removes', async () => {
    const body = { kind: 'vacancy', targetId: 'fav-vacancy', saved: true };
    expect((await put(candidate, body)).status).toBe(200);
    expect((await put(candidate, body)).status).toBe(200);
    expect(await prisma.userSavedVacancy.count()).toBe(1);
    expect(await (await get(candidate)).json()).toEqual({ kind: 'vacancy', ids: ['fav-vacancy'] });
    expect(await (await get(other)).json()).toEqual({ kind: 'vacancy', ids: [] });
    await put(other, { ...body, saved: false });
    expect(await prisma.userSavedVacancy.count()).toBe(1);
    await put(candidate, { ...body, saved: false });
    expect(await prisma.userSavedVacancy.count()).toBe(0);
  });

  it('rejects guest, role mismatch, injected owner, unavailable target and foreign Origin', async () => {
    expect((await get()).status).toBe(401);
    expect((await put(candidate, { kind: 'candidate', targetId: 'fav-candidate', saved: true })).status).toBe(403);
    expect((await put(candidate, { kind: 'vacancy', targetId: 'fav-vacancy', saved: true, userId: other.userId })).status).toBe(400);
    expect((await put(candidate, { kind: 'vacancy', targetId: 'missing', saved: true })).status).toBe(404);
    await prisma.vacancy.update({ where: { id: 'fav-vacancy' }, data: { archivedAt: new Date() } });
    expect((await put(candidate, { kind: 'vacancy', targetId: 'fav-vacancy', saved: true })).status).toBe(404);
    const req = jsonRequest('/api/favorites', 'PUT', { kind: 'candidate', targetId: 'fav-candidate', saved: true }, cookie(employer));
    req.headers.set('origin', 'https://evil.example');
    expect((await PUT(req)).status).toBe(403);
  });

  it('rechecks hidden profiles and contact consent, never snapshots private contact into favorites', async () => {
    expect((await put(employer, { kind: 'candidate', targetId: 'fav-candidate', saved: true })).status).toBe(200);
    let result = await savedCandidateCards(employer);
    expect(result.cards[0]!.displayName).toMatch(/^Кандидат #/);
    expect(result.cards[0]!.contacts).toBeNull();
    expect(JSON.stringify(result)).not.toContain('@private_contact');
    await prisma.invitation.create({ data: { companyId: 'fav-company', employerProfileId: employer.employerProfileId, candidateId: candidate.candidateId, status: 'accepted', salaryFrom: 100000, salaryTo: 200000 } });
    result = await savedCandidateCards(employer);
    expect(result.cards[0]!.contacts?.contact).toBe('@private_contact');
    await prisma.candidate.update({ where: { id: candidate.candidateId }, data: { hiddenFromEmployers: true } });
    expect(await savedCandidateCards(employer)).toEqual({ cards: [], unavailable: 1 });
    expect((await put(employer, { kind: 'candidate', targetId: 'fav-candidate', saved: true })).status).toBe(404);
    expect((await put(employer, { kind: 'candidate', targetId: 'fav-candidate', saved: false })).status).toBe(200);
  });

  it('deletes saved links when their target is deleted', async () => {
    await put(candidate, { kind: 'vacancy', targetId: 'fav-vacancy', saved: true });
    await prisma.vacancy.delete({ where: { id: 'fav-vacancy' } });
    expect(await prisma.userSavedVacancy.count()).toBe(0);
  });
});
