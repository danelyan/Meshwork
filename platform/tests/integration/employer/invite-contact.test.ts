// Q-35 (контакт кандидата) и Q-38 (вилка и способ связи компании в приглашении, ТЗ 2.2).
import { GET as listInvites, POST as invite } from '@/app/api/employer/invitations/route';
import { POST as respond } from '@/app/api/invitations/[id]/route';
import { GET as myInvites } from '@/app/api/invitations/route';
import { GET as getContact, POST as setContact } from '@/app/api/profile/contact/route';
import { createInvitation } from '@/server/employer/invitations';
import { signUserSession } from '@/server/session';

import { seedAuth, DEMO_EMPLOYER } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const candCookie = (candidateId: string) => `cid=${signUserSession({ userId: `u-${candidateId}`, role: 'candidate', candidateId })}`;
const PAY = DEMO_POOL[0]!;
const JUN = DEMO_POOL[2]!;
const PAY_VAC = 'demo-vac-be-m-1';
const ctx = { companyId: DEMO_EMPLOYER.companyId, employerProfileId: DEMO_EMPLOYER.profileId };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (body: Record<string, unknown>) =>
  invite(jsonRequest('/api/employer/invitations', 'POST', { candidateId: PAY.id, vacancyId: PAY_VAC, message: 'Платёжная команда, Go и Kafka', ...body }, EMP));

async function accept(candidateId: string, id: string) {
  const r = await respond(jsonRequest('/x', 'POST', { action: 'accept' }, candCookie(candidateId)), params(id));
  expect(r.status).toBe(200);
}

async function trackedContacts(candidateId: string) {
  const body = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
  return body.invitations.find((i: { candidate: { id: string } }) => i.candidate.id === candidateId).candidate.contacts;
}

describe('приглашение: вилка, контакт компании и контакт кандидата (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    // Роль аккаунта совпадает с ролью куки (ADR 0004: иначе кука протухшая).
    await prisma.user.createMany({ data: DEMO_POOL.map((c) => ({ id: `u-${c.id}`, name: c.id, role: 'candidate' as const })), skipDuplicates: true });
  });
  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('вилка: оба конца обязательны, «до» не меньше «от» — иначе 400; сохраняется как есть', async () => {
    expect((await post({ salaryFrom: 250000, salaryTo: 200000 })).status).toBe(400);
    expect((await post({ salaryFrom: 200000 })).status).toBe(400);
    expect((await post({ salaryTo: 200000 })).status).toBe(400);
    expect((await post({ salaryFrom: 0, salaryTo: 200000 })).status).toBe(400);
    expect((await post({ salaryOffer: 200000 })).status).toBe(400);
    expect(await prisma.invitation.count()).toBe(0);

    const ok = await post({ salaryFrom: 200000, salaryTo: 260000 });
    expect(ok.status).toBe(201);
    const { id } = await ok.json();
    expect(await prisma.invitation.findUnique({ where: { id }, select: { salaryFrom: true, salaryTo: true } })).toEqual({ salaryFrom: 200000, salaryTo: 260000 });
    const tracked = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(tracked.invitations[0]).toMatchObject({ salaryFrom: 200000, salaryTo: 260000 });
  });

  it('кандидат видит компанию, описание, вилку и способ связи до принятия; работодатель контакт кандидата — нет', async () => {
    const { id } = await createInvitation(ctx, { candidateId: PAY.id, vacancyId: PAY_VAC, message: 'Платёжная команда', salaryFrom: 200000, salaryTo: 260000 });
    const mine = await (await myInvites(jsonRequest('/x', 'GET', undefined, candCookie(PAY.id)))).json();
    expect(mine.invitations[0]).toMatchObject({
      id,
      status: 'sent',
      salaryFrom: 200000,
      salaryTo: 260000,
      message: 'Платёжная команда',
      company: { name: 'Северный Поток', description: expect.any(String), contact: 'hr.northstream@example.com' },
    });
    expect(await trackedContacts(PAY.id)).toBeNull();
  });

  it('способ связи компании: нет Company.contact — почта отправителя; служебной почты нет — null', async () => {
    await prisma.company.update({ where: { id: ctx.companyId }, data: { contact: null } });
    await createInvitation(ctx, { candidateId: PAY.id, message: 'Платёжная команда', salaryFrom: 1, salaryTo: 1 });
    let mine = await (await myInvites(jsonRequest('/x', 'GET', undefined, candCookie(PAY.id)))).json();
    expect(mine.invitations[0].company.contact).toBe(DEMO_EMPLOYER.email);

    await prisma.user.update({ where: { id: DEMO_EMPLOYER.userId }, data: { email: 'user-x@users.invalid' } });
    mine = await (await myInvites(jsonRequest('/x', 'GET', undefined, candCookie(PAY.id)))).json();
    expect(mine.invitations[0].company.contact).toBeNull();
  });

  it('контакт кандидата после accepted: указанный кандидатом; не указан — почта; служебная почта — null, не пустая строка', async () => {
    const { id } = await createInvitation(ctx, { candidateId: PAY.id, message: 'Платёжная команда', salaryFrom: 1, salaryTo: 1 });
    await accept(PAY.id, id);
    expect(await trackedContacts(PAY.id)).toEqual({ name: PAY.name, contact: 'candidate.be-m-pay@example.com' });

    await prisma.candidate.update({ where: { id: PAY.id }, data: { contact: null } });
    expect(await trackedContacts(PAY.id)).toEqual({ name: PAY.name, contact: `${PAY.id}@example.test` });

    await prisma.candidate.update({ where: { id: PAY.id }, data: { email: `user-${PAY.id}@users.invalid` } });
    expect(await trackedContacts(PAY.id)).toEqual({ name: PAY.name, contact: null });
  });

  it('/api/profile/contact: почта и Telegram нормализуются, мусор — 400, пусто — убрать', async () => {
    const save = (contact: unknown) => setContact(jsonRequest('/api/profile/contact', 'POST', { contact }, candCookie(JUN.id)));
    expect(await (await save('https://t.me/Artem_Koval')).json()).toEqual({ contact: '@Artem_Koval' });
    expect(await (await save(' artem@example.com ')).json()).toEqual({ contact: 'artem@example.com' });
    for (const bad of ['привет', '@abc', 'a@b', 'user-1@users.invalid', 'x'.repeat(130)]) expect((await save(bad)).status).toBe(400);
    expect((await (await getContact(jsonRequest('/x', 'GET', undefined, candCookie(JUN.id)))).json()).contact).toBe('artem@example.com');
    expect(await (await save('')).json()).toEqual({ contact: null });
    expect((await save('a@b.ru')).status).toBe(200);
    // работодатель не может менять контакт кандидата
    expect((await setContact(jsonRequest('/api/profile/contact', 'POST', { contact: 'x@y.ru' }, EMP))).status).toBe(403);
  });
});
