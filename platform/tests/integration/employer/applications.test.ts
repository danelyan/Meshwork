// Самоотклик (R-C-12) и граница приватности (R-E-07): контакты – только при accepted и действующем раскрытии по отклику.
import { GET as myApplications } from '@/app/api/career/applications/route';
import { POST as apply } from '@/app/api/career/vacancies/[id]/apply/route';
import { DELETE as revoke } from '@/app/api/consents/[kind]/route';
import { PATCH as answer } from '@/app/api/employer/applications/[id]/route';
import { GET as companyInvites } from '@/app/api/employer/invitations/route';
import { GET as vacancyApplications } from '@/app/api/employer/vacancies/[id]/applications/route';
import { createApplication } from '@/server/employer/applications';
import { pseudonym } from '@/server/employer/privacy';
import { consentVersion } from '@/server/consent/texts';
import { signUserSession } from '@/server/session';

import { grantEmployerConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const CAND = 'cand-ap';
const cand = `cid=${signUserSession({ userId: 'u-cand', role: 'candidate', candidateId: CAND })}`;
const empA = `cid=${signUserSession({ userId: 'u-a', role: 'employer', employerProfileId: 'p-a' })}`;
const empB = `cid=${signUserSession({ userId: 'u-b', role: 'employer', employerProfileId: 'p-b' })}`;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const local = (url: string, method: string, body: unknown, cookie: string) => {
  const r = jsonRequest(url, method, body, cookie);
  r.headers.set('origin', 'http://localhost');
  return r;
};
const V = consentVersion('identity_disclosure');
const errCode = async (r: Response) => [r.status, ((await r.json()) as { error?: { code: string } }).error?.code];

async function seed(hidden = false) {
  await prisma.candidate.create({ data: { id: CAND, name: 'Анна Кандидатова', email: 'anna@example.test', specialization: 'backend', contact: '@anna', hiddenFromEmployers: hidden } });
  await prisma.user.create({ data: { id: 'u-cand', name: 'Анна', role: 'candidate', candidateId: CAND } });
  for (const x of ['a', 'b']) {
    await prisma.company.create({ data: { id: `co-${x}`, name: `Компания ${x}`, isDemo: false } });
    await prisma.user.create({ data: { id: `u-${x}`, name: `HR ${x}`, role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: `p-${x}`, userId: `u-${x}`, companyId: `co-${x}` } });
  }
  await grantEmployerConsents(['u-a', 'u-b']);
  const vac = { specialization: 'backend' as const, grade: 'junior' as const, salaryFrom: 100000, salaryTo: 150000, needs: [] };
  await prisma.vacancy.create({ data: { id: 'vac-a', companyId: 'co-a', title: 'Backend', ...vac } });
  await prisma.vacancy.create({ data: { id: 'vac-old', companyId: 'co-a', title: 'Старая', archivedAt: new Date(), ...vac } });
}

const doApply = (vacancyId: string, body: unknown = { message: 'Хочу к вам', disclosureVersion: V }) =>
  apply(local(`/api/career/vacancies/${vacancyId}/apply`, 'POST', body, cand), params({ id: vacancyId }));
const listFor = async (cookie: string, vacancyId = 'vac-a') => vacancyApplications(jsonRequest(`/api/employer/vacancies/${vacancyId}/applications?view=1`, 'GET', undefined, cookie), params({ id: vacancyId }));
const answerAs = (cookie: string, id: string, action: 'accept' | 'decline') => answer(local(`/api/employer/applications/${id}`, 'PATCH', { action }, cookie), params({ id }));

describe('самоотклик (R-C-12, R-E-07)', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(() => prisma.$disconnect());

  it('архивная или несуществующая вакансия – 404, без галочки раскрытия – 409 consent_required, длинное сообщение – 400', async () => {
    await seed();
    expect((await doApply('vac-old')).status).toBe(404);
    expect((await doApply('nope')).status).toBe(404);
    expect(await errCode(await doApply('vac-a', { message: 'x' }))).toEqual([409, 'consent_required']);
    expect((await doApply('vac-a', { message: 'x'.repeat(1001), disclosureVersion: V })).status).toBe(400);
    expect((await doApply('vac-a', { disclosureVersion: 'old' })).status).toBe(409);
    expect(await prisma.application.count()).toBe(0);
  });

  it('повтор – 409, лимит за сутки – 429', async () => {
    await seed();
    expect((await doApply('vac-a')).status).toBe(201);
    expect((await doApply('vac-a')).status).toBe(409);
    await prisma.vacancy.create({ data: { id: 'vac-a2', companyId: 'co-a', title: 'Ещё', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [] } });
    await expect(createApplication(CAND, 'vac-a2', { disclosureVersion: V }, 1)).rejects.toMatchObject({ status: 429 });
  });

  it('чужая компания не видит отклики и не может ответить', async () => {
    await seed();
    const { id } = await (await doApply('vac-a')).json();
    expect((await listFor(empB)).status).toBe(404);
    expect((await answerAs(empB, id, 'accept')).status).toBe(404);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe('sent');
  });

  it('до accepted – псевдоним без контактов; после – имя и контакт; отзыв раскрытия снова закрывает', async () => {
    await seed();
    const { id } = await (await doApply('vac-a')).json();
    const before = (await (await listFor(empA)).json()).applications;
    expect(before).toHaveLength(1);
    expect(before[0].status).toBe('viewed');
    expect(before[0].candidate.displayName).toBe(pseudonym(CAND));
    expect(before[0].candidate.contacts).toBeNull();
    expect(JSON.stringify(before)).not.toContain('Анна');
    expect(JSON.stringify(before)).not.toContain('@anna');

    expect((await answerAs(empA, id, 'accept')).status).toBe(200);
    expect((await answerAs(empA, id, 'decline')).status).toBe(409);
    const after = (await (await listFor(empA)).json()).applications;
    expect(after[0].candidate.contacts).toEqual({ name: 'Анна Кандидатова', contact: '@anna' });

    const mine = (await (await myApplications(jsonRequest('/api/career/applications', 'GET', undefined, cand))).json()).applications;
    expect(mine[0]).toMatchObject({ status: 'accepted', disclosed: true, vacancy: { id: 'vac-a', companyName: 'Компания a' } });

    const r = await revoke(local(`/api/consents/identity_disclosure?applicationId=${id}`, 'DELETE', undefined, cand), params({ kind: 'identity_disclosure' }));
    expect(r.status).toBe(200);
    const revoked = (await (await listFor(empA)).json()).applications;
    expect(revoked[0].candidate.contacts).toBeNull();
    expect(revoked[0].candidate.displayName).toBe(pseudonym(CAND));
  });

  it('принятый отклик без действующего раскрытия контакты не открывает; раскрытие по отклику не открывает приглашения', async () => {
    await seed();
    const { id } = await (await doApply('vac-a')).json();
    await prisma.consent.updateMany({ where: { kind: 'identity_disclosure' }, data: { revokedAt: new Date() } });
    await answerAs(empA, id, 'accept');
    expect((await (await listFor(empA)).json()).applications[0].candidate.contacts).toBeNull();

    // Действующее раскрытие по отклику не должно засчитываться как раскрытие по принятому приглашению той же компании.
    await prisma.consent.updateMany({ where: { kind: 'identity_disclosure' }, data: { revokedAt: null } });
    await prisma.invitation.create({ data: { id: 'inv-x', companyId: 'co-a', employerProfileId: 'p-a', candidateId: CAND, salaryFrom: 1, salaryTo: 2, status: 'accepted' } });
    const invs = (await (await companyInvites(jsonRequest('/x', 'GET', undefined, empA))).json()).invitations;
    expect(invs[0].candidate.contacts).toBeNull();
  });

  it('скрытый из поиска кандидат может откликнуться: видит только эта компания и под псевдонимом', async () => {
    await seed(true);
    expect((await doApply('vac-a')).status).toBe(201);
    const list = (await (await listFor(empA)).json()).applications;
    expect(list[0].candidate.displayName).toBe(pseudonym(CAND));
    expect(list[0].candidate.contacts).toBeNull();
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: CAND } })).hiddenFromEmployers).toBe(true);
  });

  it('работодатель без оферты – 409 consent_required', async () => {
    await seed();
    await prisma.consent.updateMany({ where: { userId: 'u-a' }, data: { revokedAt: new Date() } });
    expect(await errCode(await listFor(empA))).toEqual([409, 'consent_required']);
  });
});
