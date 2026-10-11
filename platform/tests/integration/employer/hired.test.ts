// lane hired: финальный этап «нанят через компанию» — переход accepted → hired, права и поиск других компаний.
import { POST as hire } from '@/app/api/employer/invitations/[id]/hire/route';
import { GET as listInvites } from '@/app/api/employer/invitations/route';
import { GET as search } from '@/app/api/employer/search/route';
import { POST as respond } from '@/app/api/invitations/[id]/route';
import { GET as myInvites } from '@/app/api/invitations/route';
import { journeyState } from '@/server/agent/journey';
import { createInvitation } from '@/server/employer/invitations';
import { signUserSession } from '@/server/session';

import { seedAuth, DEMO_EMPLOYER } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { DISCLOSURE_VERSION, grantEmployerConsents, linkCandidateUsers } from '../../helpers/consents';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const OTHER = `cid=${signUserSession({ userId: 'u-other', role: 'employer', employerProfileId: 'p-other' })}`;
const candCookie = (candidateId: string) => `cid=${signUserSession({ userId: `u-${candidateId}`, role: 'candidate', candidateId })}`;
const PAY = DEMO_POOL[0]!;
const ctx = { companyId: DEMO_EMPLOYER.companyId, employerProfileId: DEMO_EMPLOYER.profileId };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const markHired = (id: string, cookie = EMP) => hire(jsonRequest(`/api/employer/invitations/${id}/hire`, 'POST', {}, cookie), params(id));

async function accepted(): Promise<string> {
  const { id } = await createInvitation(ctx, { candidateId: PAY.id, message: 'Платёжная команда, Go и Kafka', salaryFrom: 200000, salaryTo: 260000 });
  const r = await respond(jsonRequest('/x', 'POST', { action: 'accept', disclosureVersion: DISCLOSURE_VERSION }, candCookie(PAY.id)), params(id));
  expect(r.status).toBe(200);
  return id;
}

const searchIds = async (cookie: string) =>
  ((await (await search(jsonRequest('/api/employer/search?spec=backend', 'GET', undefined, cookie))).json()) as { items: { candidate: { id: string } }[] }).items.map((i) => i.candidate.id);

describe('lane hired: отметка найма (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await prisma.user.createMany({
      data: [{ id: 'u-other', name: 'u-other', role: 'employer' as const }, ...DEMO_POOL.map((c) => ({ id: `u-${c.id}`, name: c.id, role: 'candidate' as const }))],
      skipDuplicates: true,
    });
  });
  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.company.upsert({ where: { id: 'co-other' }, update: {}, create: { id: 'co-other', name: 'Другая', isDemo: false } });
    await prisma.employerProfile.upsert({ where: { userId: 'u-other' }, update: {}, create: { id: 'p-other', userId: 'u-other', companyId: 'co-other' } });
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
    await linkCandidateUsers(DEMO_POOL.map((c) => c.id));
    await prisma.consent.deleteMany({ where: { userId: 'u-other' } });
    await grantEmployerConsents(['u-other']);
  });
  afterAll(() => prisma.$disconnect());

  it('accepted → hired: hiredAt, идемпотентно, контакты остаются открыты, кандидат видит этап', async () => {
    const id = await accepted();
    const r = await markHired(id);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ id, status: 'hired', hiredAt: expect.any(String) });
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id }, select: { status: true, hiredAt: true } });
    expect(row.status).toBe('hired');
    expect(row.hiredAt?.toISOString()).toBe(body.hiredAt);

    const again = await markHired(id);
    expect(again.status).toBe(200);
    expect((await again.json()).hiredAt).toBe(body.hiredAt);

    const tracked = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(tracked.invitations[0]).toMatchObject({ status: 'hired', hiredAt: body.hiredAt });
    expect(tracked.invitations[0].candidate.contacts).toMatchObject({ name: PAY.name });

    const mine = await (await myInvites(jsonRequest('/x', 'GET', undefined, candCookie(PAY.id)))).json();
    expect(mine.invitations[0]).toMatchObject({ status: 'hired', hiredAt: body.hiredAt, disclosed: true, company: { name: 'Северный Поток' } });

    const journey = await journeyState(PAY.id);
    expect(journey.nextStep).toBe('hired');
    expect(journey.hired?.company).toBe('Северный Поток');
  });

  it('права: чужой работодатель — 404, кандидат — 403, не принятое — 409, отклонённое — 409', async () => {
    const { id: sent } = await createInvitation(ctx, { candidateId: PAY.id, message: 'Платёжная команда, Go и Kafka', salaryFrom: 1, salaryTo: 1 });
    expect((await markHired(sent)).status).toBe(409);
    expect((await markHired('nope')).status).toBe(404);
    expect((await markHired(sent, candCookie(PAY.id))).status).toBe(403);

    await respond(jsonRequest('/x', 'POST', { action: 'decline' }, candCookie(PAY.id)), params(sent));
    expect((await markHired(sent)).status).toBe(409);

    const id = await accepted();
    expect((await markHired(id, OTHER)).status).toBe(404);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).status).toBe('accepted');
  });

  it('поиск: нанятый скрыт у других компаний и остаётся у нанявшей', async () => {
    expect(await searchIds(OTHER)).toContain(PAY.id);
    const id = await accepted();
    expect((await markHired(id)).status).toBe(200);
    expect(await searchIds(OTHER)).not.toContain(PAY.id);
    expect(await searchIds(EMP)).toContain(PAY.id);
  });
});
