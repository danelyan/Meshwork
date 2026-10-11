// lane lifecycle: найм закрывает чужие приглашения и отклики, пауза 14 дней после отказа/отзыва, архив вакансии,
// принятый самоотклик → приглашение accepted (раскрытие переносится, лимит не расходуется).
import { DELETE as revoke } from '@/app/api/consents/[kind]/route';
import { PATCH as answer } from '@/app/api/employer/applications/[id]/route';
import { POST as hire } from '@/app/api/employer/invitations/[id]/hire/route';
import { GET as companyInvites } from '@/app/api/employer/invitations/route';
import { PATCH as patchVacancy } from '@/app/api/employer/vacancies/[id]/route';
import { POST as respond } from '@/app/api/invitations/[id]/route';
import { notifications } from '@/server/auth/notifications';
import { disclosedInvitationIds } from '@/server/consent/service';
import { consentVersion } from '@/server/consent/texts';
import { createApplication } from '@/server/employer/applications';
import { HIRED_ELSEWHERE_REASON, INVITE_COOLDOWN_DAYS, VACANCY_CLOSED_REASON, createInvitation, invitationsSentToday, withdrawInvitation } from '@/server/employer/invitations';
import { signUserSession } from '@/server/session';

import { grantEmployerConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const V = consentVersion('identity_disclosure');
const DAY = 86_400_000;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const local = (url: string, method: string, body: unknown, cookie: string) => {
  const r = jsonRequest(url, method, body, cookie);
  r.headers.set('origin', 'http://localhost');
  return r;
};
const emp = (x: string) => `cid=${signUserSession({ userId: `u-${x}`, role: 'employer', employerProfileId: `p-${x}` })}`;
const cand = (id: string) => `cid=${signUserSession({ userId: `u-${id}`, role: 'candidate', candidateId: id })}`;
const ctx = (x: string) => ({ companyId: `co-${x}`, employerProfileId: `p-${x}` });
const invite = (x: string, candidateId: string, vacancyId?: string, limit?: number) =>
  createInvitation(ctx(x), { candidateId, vacancyId, message: 'Платёжная команда, Go и Kafka', salaryFrom: 200000, salaryTo: 260000 }, limit);
const accept = (candidateId: string, id: string) => respond(local('/x', 'POST', { action: 'accept', disclosureVersion: V }, cand(candidateId)), params(id));
const decline = (candidateId: string, id: string) => respond(local('/x', 'POST', { action: 'decline' }, cand(candidateId)), params(id));
const markHired = (x: string, id: string) => hire(local(`/api/employer/invitations/${id}/hire`, 'POST', {}, emp(x)), params(id));
const status = async (id: string) => (await prisma.invitation.findUniqueOrThrow({ where: { id } })).status;
const errOf = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; status?: number; details?: unknown }) => e);

const CANDS = ['c1', 'c2', 'c3'];
const NAMES: Record<string, string> = { a: 'Альфа Найм', b: 'Бета', c: 'Гамма' };

async function seed() {
  for (const id of CANDS) {
    await prisma.candidate.create({ data: { id, name: `Имя ${id}`, email: `${id}@example.test`, specialization: 'backend', contact: `@${id}`, hiddenFromEmployers: false } });
    await prisma.user.create({ data: { id: `u-${id}`, name: id, role: 'candidate', candidateId: id } });
  }
  for (const x of ['a', 'b', 'c']) {
    // E05: без контакта компании (или почты отправителя) приглашение не уходит – фикстура задаёт контакт
    await prisma.company.create({ data: { id: `co-${x}`, name: NAMES[x]!, isDemo: false, contact: `hr-${x}@example.test` } });
    await prisma.user.create({ data: { id: `u-${x}`, name: `HR ${x}`, role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: `p-${x}`, userId: `u-${x}`, companyId: `co-${x}` } });
    await prisma.vacancy.create({ data: { id: `vac-${x}`, companyId: `co-${x}`, title: `Backend ${x}`, specialization: 'backend', grade: 'junior', salaryFrom: 150000, salaryTo: 180000, needs: [] } });
  }
  await grantEmployerConsents(['u-a', 'u-b', 'u-c']);
}

describe('lane lifecycle: жизненный цикл приглашений и откликов (БД)', () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });
  afterAll(() => prisma.$disconnect());

  it('найм в A закрывает приглашения B (accepted) и C (viewed) и открытый отклик к B; B получает уведомление без имени A', async () => {
    const { id: a } = await invite('a', 'c1');
    const { id: b } = await invite('b', 'c1');
    const { id: c } = await invite('c', 'c1');
    await prisma.invitation.update({ where: { id: c }, data: { status: 'viewed', viewedAt: new Date() } });
    expect((await accept('c1', a)).status).toBe(200);
    expect((await accept('c1', b)).status).toBe(200);
    await prisma.liveDefense.create({ data: { invitationId: b, companyId: 'co-b', candidateId: 'c1', activeKey: b, status: 'slots_proposed', durationMin: 30 } });
    const app = await createApplication('c1', 'vac-b', { disclosureVersion: V });
    expect((await disclosedInvitationIds([b])).has(b)).toBe(true);

    expect((await markHired('a', a)).status).toBe(200);
    expect(await status(a)).toBe('hired');
    const rb = await prisma.invitation.findUniqueOrThrow({ where: { id: b } });
    expect(rb).toMatchObject({ status: 'closed_hired', closedAt: expect.any(Date) });
    expect(await status(c)).toBe('closed_hired');
    expect(await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: 'closed', closeReason: HIRED_ELSEWHERE_REASON });
    // раскрытие по закрытому приглашению B прекращено, живая защита B закрыта
    expect((await disclosedInvitationIds([b])).has(b)).toBe(false);
    expect((await prisma.liveDefense.findFirstOrThrow({ where: { invitationId: b } })).status).toBe('cancelled');
    // B больше не может нанять, кандидат не может ответить C
    expect((await markHired('b', b)).status).toBe(409);
    expect((await accept('c1', c)).status).toBe(409);

    const feedB = await notifications({ userId: 'u-b', role: 'employer', employerProfileId: 'p-b', candidateId: null });
    const closedItems = feedB.items.filter((i) => i.text === HIRED_ELSEWHERE_REASON);
    expect(closedItems).toHaveLength(2); // приглашение и отклик
    expect(JSON.stringify(feedB)).not.toContain(NAMES.a);
    // кандидату отдельного уведомления о закрытии нет
    const feedC = await notifications({ userId: 'u-c1', role: 'candidate', candidateId: 'c1', employerProfileId: null });
    expect(feedC.items.some((i) => i.text === HIRED_ELSEWHERE_REASON)).toBe(false);
    // приглашения кандидата другим компаниям после найма – финальные, у A найм не тронут
    expect(await prisma.invitation.count({ where: { candidateId: 'c1', status: { in: ['sent', 'viewed', 'accepted'] } } })).toBe(0);
  });

  it('пауза 14 дней: после отказа – 409 invite_cooldown с nextAt, через 14 дней – можно; после отзыва – тоже пауза', async () => {
    const { id } = await invite('a', 'c1');
    expect((await decline('c1', id)).status).toBe(200);
    const respondedAt = (await prisma.invitation.findUniqueOrThrow({ where: { id } })).respondedAt!;
    const err = await errOf(invite('a', 'c1'));
    expect(err).toMatchObject({ code: 'invite_cooldown', status: 409 });
    expect((err as { details: { nextAt: string } }).details.nextAt).toBe(new Date(respondedAt.getTime() + INVITE_COOLDOWN_DAYS * DAY).toISOString());
    // другая компания пауза не касается
    await expect(invite('b', 'c1')).resolves.toMatchObject({ status: 'sent' });
    // граница: 13 дней назад – ещё пауза, 14 дней и минута – уже нет
    await prisma.invitation.update({ where: { id }, data: { respondedAt: new Date(Date.now() - 13 * DAY) } });
    expect(await errOf(invite('a', 'c1'))).toMatchObject({ code: 'invite_cooldown' });
    await prisma.invitation.update({ where: { id }, data: { respondedAt: new Date(Date.now() - INVITE_COOLDOWN_DAYS * DAY - 60_000) } });
    const { id: again } = await invite('a', 'c1');

    await withdrawInvitation({ companyId: 'co-a', userId: 'u-a' }, again, 'Позиция заморожена');
    expect(await errOf(invite('a', 'c1'))).toMatchObject({ code: 'invite_cooldown', status: 409 });
  });

  it('архив вакансии: sent/viewed отзываются с причиной, accepted не трогается, открытые отклики закрываются; паузы нет', async () => {
    const { id: s1 } = await invite('a', 'c1', 'vac-a');
    const { id: v2 } = await invite('a', 'c2', 'vac-a');
    await prisma.invitation.update({ where: { id: v2 }, data: { status: 'viewed', viewedAt: new Date() } });
    const { id: a3 } = await invite('a', 'c3', 'vac-a');
    expect((await accept('c3', a3)).status).toBe(200);
    const app = await createApplication('c2', 'vac-a', { disclosureVersion: V });

    const r = await patchVacancy(local('/api/employer/vacancies/vac-a', 'PATCH', { archived: true }, emp('a')), params('vac-a'));
    expect(r.status).toBe(200);
    expect((await r.json()).closed).toEqual({ withdrawnInvitations: 2, acceptedInvitations: 1, closedApplications: 1 });
    for (const id of [s1, v2]) expect(await prisma.invitation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'withdrawn', withdrawReason: VACANCY_CLOSED_REASON });
    expect(await status(a3)).toBe('accepted');
    expect(await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: 'closed', closeReason: VACANCY_CLOSED_REASON });
    // отзыв из-за закрытия вакансии – не отказ кандидату: пригласить снова можно сразу
    await expect(invite('a', 'c1')).resolves.toMatchObject({ status: 'sent' });
  });

  it('принятый самоотклик → приглашение accepted: раскрытие только после принятия, лимит не расходуется, дальше найм', async () => {
    const app = await createApplication('c1', 'vac-a', { disclosureVersion: V });
    // до принятия – приглашения нет, компания видит только псевдоним
    expect(await prisma.invitation.count()).toBe(0);
    const before = await (await companyInvites(jsonRequest('/x', 'GET', undefined, emp('a')))).json();
    expect(before.invitations).toHaveLength(0);

    const r = await answer(local(`/api/employer/applications/${app.id}`, 'PATCH', { action: 'accept' }, emp('a')), params(app.id));
    expect(r.status).toBe(200);
    const { invitationId } = await r.json();
    const inv = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(inv).toMatchObject({ status: 'accepted', companyId: 'co-a', vacancyId: 'vac-a', salaryFrom: 150000, salaryTo: 180000, sourceApplicationId: app.id, employerProfileId: 'p-a' });
    expect(await invitationsSentToday('co-a')).toBe(0);
    // лимит 1 в сутки: созданное из отклика приглашение его не съело
    await expect(invite('a', 'c2', undefined, 1)).resolves.toMatchObject({ status: 'sent' });

    const tracked = (await (await companyInvites(jsonRequest('/x', 'GET', undefined, emp('a')))).json()).invitations as { id: string; candidate: { contacts: { name: string } | null } }[];
    expect(tracked.find((t) => t.id === invitationId)?.candidate.contacts).toMatchObject({ name: 'Имя c1' });
    // согласие одно: context содержит и applicationId, и invitationId
    expect(await prisma.consent.count({ where: { kind: 'identity_disclosure', user: { candidateId: 'c1' } } })).toBe(1);

    expect((await markHired('a', invitationId)).status).toBe(200);
    // отзыв раскрытия по отклику прекращает и раскрытие по приглашению
    const rv = await revoke(local(`/api/consents/identity_disclosure?applicationId=${app.id}`, 'DELETE', undefined, cand('c1')), { params: Promise.resolve({ kind: 'identity_disclosure' }) });
    expect(rv.status).toBe(200);
    expect((await disclosedInvitationIds([invitationId])).has(invitationId)).toBe(false);
  });

  it('отклонённый отклик приглашения не создаёт; повторный ответ – 409', async () => {
    const app = await createApplication('c1', 'vac-a', { disclosureVersion: V });
    const r = await answer(local(`/api/employer/applications/${app.id}`, 'PATCH', { action: 'decline' }, emp('a')), params(app.id));
    expect(r.status).toBe(200);
    expect(await prisma.invitation.count()).toBe(0);
    expect((await answer(local(`/api/employer/applications/${app.id}`, 'PATCH', { action: 'accept' }, emp('a')), params(app.id))).status).toBe(409);
    expect(await prisma.invitation.count()).toBe(0);
  });
});
