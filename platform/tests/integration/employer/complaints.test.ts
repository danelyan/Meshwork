// lane complaints: жалоба кандидата на приглашение и санкции компании (R-X-01, пороги – ПРЕДЛОЖЕНИЕ, не калибровано).
import { POST as complain } from '@/app/api/invitations/[id]/complaint/route';
import { GET as myInvites } from '@/app/api/invitations/route';
import { GET as listInvites } from '@/app/api/employer/invitations/route';
import { createInvitation } from '@/server/employer/invitations';
import { signUserSession } from '@/server/session';

import { seedAuth, DEMO_EMPLOYER } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { grantEmployerConsents, linkCandidateUsers } from '../../helpers/consents';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const candCookie = (candidateId: string) => `cid=${signUserSession({ userId: `u-${candidateId}`, role: 'candidate', candidateId })}`;
const ctx = { companyId: DEMO_EMPLOYER.companyId, employerProfileId: DEMO_EMPLOYER.profileId };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const A = DEMO_POOL[0]!;
const B = DEMO_POOL[1]!;
const file = (id: string, cookie: string, body: unknown = { reason: 'spam', comment: 'Массовая рассылка' }) =>
  complain(jsonRequest(`/api/invitations/${id}/complaint`, 'POST', body, cookie), params(id));
const invite = (candidateId: string) =>
  createInvitation(ctx, { candidateId, message: 'Платёжная команда, Go и Kafka, высокая нагрузка', salaryFrom: 200000, salaryTo: 260000 });

/** n жалоб на компанию напрямую в БД – по одной на отдельное приглашение (unique invitationId). */
async function seedComplaints(n: number, status: 'open' | 'dismissed' = 'open', createdAt = new Date()) {
  for (let i = 0; i < n; i++) {
    const inv = await prisma.invitation.create({
      data: { companyId: ctx.companyId, employerProfileId: ctx.employerProfileId, candidateId: DEMO_POOL[i % DEMO_POOL.length]!.id, salaryFrom: 1, salaryTo: 2, status: 'declined', createdAt: new Date(Date.now() - 2 * 86_400_000) },
      select: { id: true, candidateId: true },
    });
    await prisma.complaint.create({ data: { invitationId: inv.id, companyId: ctx.companyId, candidateId: inv.candidateId, reason: 'spam', status, createdAt } });
  }
}

describe('lane complaints: жалобы на приглашения (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await prisma.user.createMany({ data: DEMO_POOL.map((c) => ({ id: `u-${c.id}`, name: c.id, role: 'candidate' as const })), skipDuplicates: true });
  });
  beforeEach(async () => {
    await prisma.complaint.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
    await linkCandidateUsers(DEMO_POOL.map((c) => c.id));
    await grantEmployerConsents([DEMO_EMPLOYER.userId]);
  });
  afterAll(() => prisma.$disconnect());

  it('кандидат жалуется на своё приглашение: 201, статус не меняется, повтор – 409, видно в списке', async () => {
    const { id } = await invite(A.id);
    const r = await file(id, candCookie(A.id));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ invitationId: id, reason: 'spam' });
    const row = await prisma.complaint.findUniqueOrThrow({ where: { invitationId: id } });
    expect(row).toMatchObject({ companyId: ctx.companyId, candidateId: A.id, status: 'open', comment: 'Массовая рассылка' });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).status).toBe('sent');

    const again = await file(id, candCookie(A.id), { reason: 'other' });
    expect(again.status).toBe(409);
    expect(await prisma.complaint.count()).toBe(1);

    const mine = await (await myInvites(jsonRequest('/x', 'GET', undefined, candCookie(A.id)))).json();
    expect(mine.invitations[0].complaint).toMatchObject({ reason: 'spam' });
  });

  it('чужое приглашение – 404, работодатель – 403, неизвестная причина и длинный комментарий – 400', async () => {
    const { id } = await invite(A.id);
    expect((await file(id, candCookie(B.id))).status).toBe(404);
    expect((await file(id, EMP)).status).toBe(403);
    expect((await file(id, candCookie(A.id), { reason: 'boring' })).status).toBe(400);
    expect((await file(id, candCookie(A.id), { reason: 'other', comment: 'x'.repeat(1001) })).status).toBe(400);
    expect(await prisma.complaint.count()).toBe(0);
  });

  it('3 жалобы за 30 дней – лимит 5 в сутки, кабинет видит сниженный лимит; dismissed и старые не считаются', async () => {
    await seedComplaints(2);
    await seedComplaints(3, 'dismissed');
    await seedComplaints(3, 'open', new Date(Date.now() - 31 * 86_400_000));
    let body = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(body.limit.sanction.level).toBe('none');

    await seedComplaints(1);
    body = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(body.limit).toMatchObject({ perDay: 5, base: 20, sanction: { level: 'reduced', complaints: 3 } });

    const pool = DEMO_POOL.slice(0, 6);
    expect(pool.length).toBe(6);
    for (const c of pool.slice(0, 5)) await invite(c.id);
    await expect(invite(pool[5]!.id)).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('5 жалоб – отправка блокируется 403 company_blocked, приглашение не создаётся', async () => {
    await seedComplaints(5);
    const before = await prisma.invitation.count();
    await expect(invite(A.id)).rejects.toMatchObject({ status: 403, code: 'company_blocked' });
    expect(await prisma.invitation.count()).toBe(before);
    const body = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(body.limit).toMatchObject({ perDay: 0, sanction: { level: 'blocked', complaints: 5 } });
  });
});
