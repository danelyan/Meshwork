import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as applicationsGet } from '@/app/api/admin/applications/route';
import { GET as candidateGet } from '@/app/api/admin/candidates/[id]/route';
import { POST as candidatePii } from '@/app/api/admin/candidates/[id]/pii/route';
import { GET as candidatesGet } from '@/app/api/admin/candidates/route';
import { GET as companyGet } from '@/app/api/admin/companies/[id]/route';
import { POST as companyPii } from '@/app/api/admin/companies/[id]/pii/route';
import { GET as companiesGet } from '@/app/api/admin/companies/route';
import { GET as dashboardGet } from '@/app/api/admin/dashboard/route';
import { GET as invitationGet } from '@/app/api/admin/invitations/[id]/route';
import { GET as invitationsGet } from '@/app/api/admin/invitations/route';
import { GET as userGet } from '@/app/api/admin/users/[id]/route';
import { POST as userPii } from '@/app/api/admin/users/[id]/pii/route';
import { GET as usersGet } from '@/app/api/admin/users/route';
import { GET as vacancyGet } from '@/app/api/admin/vacancies/[id]/route';
import { GET as vacanciesGet } from '@/app/api/admin/vacancies/route';
import { ADMIN_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';
import { pseudonym } from '@/server/employer/privacy';

import { prisma, resetDb } from '../../../helpers/db';
import { jsonRequest } from '../../../helpers/requests';

const PASS = 'staff-pass-123';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function sessionFor(role: 'owner' | 'moderator' | 'support') {
  const { staff } = await createStaff(null, { email: `${role}@example.ru`, name: role, role, password: PASS });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { staff, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}

const get = (url: string, cookie?: string) => jsonRequest(url, 'GET', undefined, cookie);

async function seed() {
  const cand = await prisma.candidate.create({ data: { email: 'ivan.petrov@yandex.ru', name: 'Иван Петров', specialization: 'backend', contact: '@ivan_pet' } });
  const cand2 = await prisma.candidate.create({ data: { email: 'olga@mail.ru', name: 'Ольга Смирнова', specialization: 'ai', fspState: 'linked' } });
  await prisma.candidateCategory.create({ data: { candidateId: cand.id, specialization: 'backend', grade: 'middle' } });
  const user = await prisma.user.create({ data: { role: 'candidate', name: 'Иван Петров', email: 'ivan.petrov@yandex.ru', candidateId: cand.id } });
  const empUser = await prisma.user.create({ data: { role: 'employer', name: 'Мария Орлова', email: 'maria@acme.ru' } });
  const company = await prisma.company.create({ data: { name: 'Акме', inn: '7707083893', contact: 'hr@acme.ru' } });
  await prisma.employerProfile.create({ data: { userId: empUser.id, companyId: company.id } });
  const vacancy = await prisma.vacancy.create({ data: { companyId: company.id, title: 'Go-разработчик', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 300000, needs: [] } });
  const inv = await prisma.invitation.create({ data: { vacancyId: vacancy.id, candidateId: cand.id, companyId: company.id, salaryFrom: 200000, salaryTo: 280000 } });
  await prisma.complaint.create({ data: { invitationId: inv.id, companyId: company.id, candidateId: cand.id, reason: 'spam' } });
  await prisma.application.create({ data: { vacancyId: vacancy.id, candidateId: cand2.id } });
  await prisma.assessmentObjection.create({ data: { candidateId: cand.id, subject: 'grade_test', subjectId: 'x', text: 'не согласен', createdAt: new Date(Date.now() - 29 * 24 * 3600_000) } });
  await prisma.agentRun.create({ data: { purpose: 'consultant', provider: 'stub', model: 'm', latencyMs: 1, inputTokens: 100, outputTokens: 50, ok: true } });
  return { cand, cand2, user, empUser, company, vacancy, inv };
}

describe('обзор админки (фаза 1): чтение, права, ПДн', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
  });

  it('без сессии персонала – 401, пользовательская кука не подходит', async () => {
    expect((await candidatesGet(get('/api/admin/candidates'))).status).toBe(401);
    expect((await dashboardGet(get('/api/admin/dashboard', 'cid=abc'))).status).toBe(401);
  });

  it('403 для роли без права: moderator не видит пользователей и не раскрывает ПДн; support не видит вакансии и приглашения', async () => {
    const d = await seed();
    const mod = await sessionFor('moderator');
    const sup = await sessionFor('support');
    expect((await usersGet(get('/api/admin/users', mod.cookie))).status).toBe(403);
    expect((await userGet(get(`/api/admin/users/${d.user.id}`, mod.cookie), ctx(d.user.id))).status).toBe(403);
    expect((await vacanciesGet(get('/api/admin/vacancies', sup.cookie))).status).toBe(403);
    expect((await invitationsGet(get('/api/admin/invitations', sup.cookie))).status).toBe(403);
    expect((await applicationsGet(get('/api/admin/applications', sup.cookie))).status).toBe(403);
    // moderator видит карточку кандидата, но раскрыть ПДн не может – и журнал при этом остаётся пустым
    expect((await candidateGet(get(`/api/admin/candidates/${d.cand.id}`, mod.cookie), ctx(d.cand.id))).status).toBe(200);
    const res = await candidatePii(jsonRequest(`/api/admin/candidates/${d.cand.id}/pii`, 'POST', { reason: 'проверка жалобы' }, mod.cookie), ctx(d.cand.id));
    expect(res.status).toBe(403);
    expect(await prisma.adminAuditLog.count({ where: { action: 'reveal_pii' } })).toBe(0);
  });

  it('дашборд: счётчики, категории, воронка, срок возражения, расход LLM за сутки', async () => {
    await seed();
    const { cookie } = await sessionFor('owner');
    const res = await dashboardGet(get('/api/admin/dashboard', cookie));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.users.byRole).toMatchObject({ candidate: 1, employer: 1 });
    expect(d.candidates).toMatchObject({ total: 2, categorized: 1, withoutFspHistory: 1 });
    expect(d.candidates.byCategory).toEqual([{ specialization: 'backend', grade: 'middle', count: 1 }]);
    expect(d.companies.total).toBe(1);
    expect(d.funnel).toMatchObject({ sent: 1, accepted: 0 });
    expect(d.moderation.openComplaints).toBe(1);
    expect(d.moderation.openObjections[0].hoursLeft).toBeGreaterThan(0);
    expect(d.moderation.openObjections[0].hoursLeft).toBeLessThanOrEqual(24);
    expect(d.llm24h).toEqual({ calls: 1, tokens: 150 });
  });

  it('список кандидатов: псевдоним и маска, без ФИО и почты; поиск по псевдониму и по почте (с правом раскрытия)', async () => {
    const d = await seed();
    const sup = await sessionFor('support');
    const mod = await sessionFor('moderator');
    const body = await (await candidatesGet(get('/api/admin/candidates', sup.cookie))).json();
    expect(body.total).toBe(2);
    const text = JSON.stringify(body);
    expect(text).not.toContain('Иван');
    expect(text).not.toContain('ivan.petrov@yandex.ru');
    expect(body.items.find((c: { id: string }) => c.id === d.cand.id)).toMatchObject({ pseudonym: pseudonym(d.cand.id), email: 'i***@y***.ru' });

    const byTag = await (await candidatesGet(get(`/api/admin/candidates?q=${encodeURIComponent(pseudonym(d.cand.id))}`, mod.cookie))).json();
    expect(byTag.items.map((c: { id: string }) => c.id)).toEqual([d.cand.id]);

    const byMail = await (await candidatesGet(get('/api/admin/candidates?q=petrov%40yandex', sup.cookie))).json();
    expect(byMail.items.map((c: { id: string }) => c.id)).toEqual([d.cand.id]);
    // модератор без права раскрытия искать по почте не может: иначе это оракул в обход журнала
    const modMail = await (await candidatesGet(get('/api/admin/candidates?q=petrov%40yandex', mod.cookie))).json();
    expect(modMail.items).toEqual([]);

    const byCat = await (await candidatesGet(get('/api/admin/candidates?specialization=backend&grade=middle', sup.cookie))).json();
    expect(byCat.items.map((c: { id: string }) => c.id)).toEqual([d.cand.id]);
  });

  it('пагинация: 25 строк на страницу, страница 2 – остаток', async () => {
    await prisma.candidate.createMany({ data: Array.from({ length: 27 }, (_, i) => ({ email: `c${i}@example.ru`, name: `Имя ${i}` })) });
    const { cookie } = await sessionFor('support');
    const p1 = await (await candidatesGet(get('/api/admin/candidates', cookie))).json();
    const p2 = await (await candidatesGet(get('/api/admin/candidates?page=2', cookie))).json();
    expect([p1.items.length, p2.items.length, p1.total, p1.pages]).toEqual([25, 2, 27, 2]);
  });

  it('раскрытие ПДн кандидата: нужна причина; успех пишет в журнал имена полей, но не значения', async () => {
    const d = await seed();
    const sup = await sessionFor('support');
    const noReason = await candidatePii(jsonRequest(`/api/admin/candidates/${d.cand.id}/pii`, 'POST', { reason: '  ' }, sup.cookie), ctx(d.cand.id));
    expect(noReason.status).toBe(400);
    expect(await prisma.adminAuditLog.count({ where: { action: 'reveal_pii' } })).toBe(0);

    const ok = await candidatePii(jsonRequest(`/api/admin/candidates/${d.cand.id}/pii`, 'POST', { reason: 'обращение в поддержку #42' }, sup.cookie), ctx(d.cand.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: 'Иван Петров', email: 'ivan.petrov@yandex.ru', contact: '@ivan_pet' });
    const rows = await prisma.adminAuditLog.findMany({ where: { action: 'reveal_pii' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: sup.staff.id, targetType: 'candidate', targetId: d.cand.id, reason: 'обращение в поддержку #42' });
    expect(JSON.stringify(rows[0]!.after)).not.toContain('ivan.petrov');
    expect(rows[0]!.after).toEqual({ fields: ['name', 'email', 'contact'] });

    const missing = await candidatePii(jsonRequest('/api/admin/candidates/none/pii', 'POST', { reason: 'проверка' }, sup.cookie), ctx('none'));
    expect(missing.status).toBe(404);
    expect(await prisma.adminAuditLog.count({ where: { action: 'reveal_pii' } })).toBe(1);
  });

  it('раскрытие у учётки и компании тоже в журнале; карточки без ПДн', async () => {
    const d = await seed();
    const sup = await sessionFor('support');
    const u = await userPii(jsonRequest(`/api/admin/users/${d.user.id}/pii`, 'POST', { reason: 'сброс доступа' }, sup.cookie), ctx(d.user.id));
    expect(await u.json()).toEqual({ name: 'Иван Петров', email: 'ivan.petrov@yandex.ru' });
    const c = await companyPii(jsonRequest(`/api/admin/companies/${d.company.id}/pii`, 'POST', { reason: 'уточнить контакт' }, sup.cookie), ctx(d.company.id));
    const cb = await c.json();
    expect(cb.contact).toBe('hr@acme.ru');
    expect(cb.representatives[0]).toMatchObject({ name: 'Мария Орлова', email: 'maria@acme.ru' });
    expect((await prisma.adminAuditLog.findMany({ where: { action: 'reveal_pii' } })).map((r) => r.targetType).sort()).toEqual(['company', 'user']);

    const card = JSON.stringify(await (await candidateGet(get(`/api/admin/candidates/${d.cand.id}`, sup.cookie), ctx(d.cand.id))).json());
    expect(card).not.toContain('Иван Петров');
    expect(card).not.toContain('@ivan_pet');
    expect(card).not.toContain('ivan.petrov@yandex.ru');
    const compCard = JSON.stringify(await (await companyGet(get(`/api/admin/companies/${d.company.id}`, sup.cookie), ctx(d.company.id))).json());
    expect(compCard).not.toContain('Мария');
    expect(compCard).not.toContain('maria@acme.ru');
    expect(compCard).not.toContain('hr@acme.ru');
  });

  it('карточка компании: индекс доверия с разбивкой из server/employer, санкция, ИНН', async () => {
    const d = await seed();
    const { cookie } = await sessionFor('moderator');
    const card = await (await companyGet(get(`/api/admin/companies/${d.company.id}`, cookie), ctx(d.company.id))).json();
    expect(card.innCheck.valid).toBe(true);
    expect(card.trust.signals.map((s: { code: string }) => s.code)).toEqual(expect.arrayContaining(['profile', 'inn', 'age', 'declines', 'complaints']));
    expect(card.sanction).toMatchObject({ level: 'none', complaints: 1 });
    expect(card.invitationStats.sent).toBe(1);
    const list = await (await companiesGet(get('/api/admin/companies?q=7707', cookie))).json();
    expect(list.items[0]).toMatchObject({ id: d.company.id, trust: card.trust.index });
  });

  it('карточка кандидата: категория, жалобы, возражения; списки приглашений, вакансий, откликов', async () => {
    const d = await seed();
    const { cookie } = await sessionFor('owner');
    const card = await (await candidateGet(get(`/api/admin/candidates/${d.cand.id}`, cookie), ctx(d.cand.id))).json();
    expect(card.currentCategory).toMatchObject({ specialization: 'backend', grade: 'middle' });
    expect([card.invitations.length, card.complaints.length, card.objections.length]).toEqual([1, 1, 1]);
    const inv = await (await invitationsGet(get('/api/admin/invitations?complaint=yes', cookie))).json();
    expect(inv.items[0]).toMatchObject({ id: d.inv.id, candidate: pseudonym(d.cand.id), complaint: 'open' });
    expect(JSON.stringify(inv)).not.toContain('Иван');
    expect((await (await invitationGet(get(`/api/admin/invitations/${d.inv.id}`, cookie), ctx(d.inv.id))).json()).complaint.reason).toBe('spam');
    expect((await (await vacanciesGet(get('/api/admin/vacancies?q=Go', cookie))).json()).items).toHaveLength(1);
    expect((await (await vacancyGet(get(`/api/admin/vacancies/${d.vacancy.id}`, cookie), ctx(d.vacancy.id))).json()).applications).toHaveLength(1);
    expect((await (await applicationsGet(get('/api/admin/applications', cookie))).json()).total).toBe(1);
    expect((await candidateGet(get('/api/admin/candidates/none', cookie), ctx('none'))).status).toBe(404);
  });
});
