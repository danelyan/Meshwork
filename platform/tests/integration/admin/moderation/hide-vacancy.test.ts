// E-08: hide_vacancy (/api/admin/vacancies/[id]/hide): скрыть → кандидат не видит → вернуть; права, журнал, повторы.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as hidePost } from '@/app/api/admin/vacancies/[id]/hide/route';
import { hiddenVacancyIds } from '@/server/admin/moderation/red-flags';
import { resolveCallAccess } from '@/server/call/access';
import { createVacancy } from '@/server/employer/vacancies';
import { VacancyInput } from '@/server/employer/schemas';
import { careerVacancies } from '@/server/recommend/career';

import { jsonRequest } from '../../../helpers/requests';

import { auditRows, ctxEmp, DEMO_POOL, params, prisma, setupWorld, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const hide = (id: string, cookie: string, body: unknown) => hidePost(jsonRequest(`/api/admin/vacancies/${id}/hide`, 'POST', body, cookie), params(id));
const mkVacancy = () =>
  createVacancy(ctxEmp.companyId, VacancyInput.parse({ title: 'Backend разработчик', specialization: 'backend', grade: 'junior', salaryFrom: 90000, salaryTo: 120000, description: 'REST API на Node.js, код-ревью и тесты', subcategoryId: 'backend.web-api', needs: [{ catalogId: 'be.rest-design', weight: 1 }] }));

describe('admin: скрыть вакансию (hide_vacancy)', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('support – 403; без причины – 400; скрыть → не видна кандидату → повтор 409 → вернуть → видна; журнал', async () => {
    const v = await mkVacancy();
    const cand = DEMO_POOL[2]!.id;
    expect((await careerVacancies(cand)).targets.some((t) => t.vacancyId === v.id)).toBe(true);
    expect((await hide(v.id, staff.support.cookie, { hidden: true, reason: 'Нарушение правил' })).status).toBe(403);
    expect((await hide(v.id, staff.moderator.cookie, { hidden: true, reason: '' })).status).toBe(400);
    expect((await hide('нет-такой', staff.moderator.cookie, { hidden: true, reason: 'Нет вакансии' })).status).toBe(404);

    expect((await hide(v.id, staff.moderator.cookie, { hidden: true, reason: 'Подозрение на мошенничество' })).status).toBe(200);
    expect(await hiddenVacancyIds()).toContain(v.id);
    expect((await careerVacancies(cand)).targets.some((t) => t.vacancyId === v.id)).toBe(false);
    // Работодатель не обходит скрытие архивированием и разархивированием.
    await prisma.vacancy.update({ where: { id: v.id }, data: { archivedAt: new Date() } });
    await prisma.vacancy.update({ where: { id: v.id }, data: { archivedAt: null } });
    expect((await careerVacancies(cand)).targets.some((t) => t.vacancyId === v.id)).toBe(false);
    expect((await hide(v.id, staff.moderator.cookie, { hidden: true, reason: 'Повторно' })).status).toBe(409);

    expect((await hide(v.id, staff.owner.cookie, { hidden: false, reason: 'Проверено, вернули' })).status).toBe(200);
    expect(await hiddenVacancyIds()).not.toContain(v.id);
    expect((await careerVacancies(cand)).targets.some((t) => t.vacancyId === v.id)).toBe(true);
    expect((await hide(v.id, staff.owner.cookie, { hidden: false, reason: 'Повторно' })).status).toBe(409);

    const rows = (await auditRows(v.id)).map((r) => ({ action: r.action, reason: !!r.reason, targetType: r.targetType }));
    expect(rows).toEqual(expect.arrayContaining([{ action: 'hide_vacancy.hidden', reason: true, targetType: 'vacancy' }, { action: 'hide_vacancy.shown', reason: true, targetType: 'vacancy' }]));
    expect(rows).toHaveLength(2);
  });

  it('заблокированный кандидат: созвон для работодателя без accepted – 404 как для скрытого', async () => {
    const cand = DEMO_POOL[3]!.id;
    const who = { userId: 'x', role: 'employer' as const, employerProfileId: ctxEmp.employerProfileId };
    const call = { id: 'call-x', candidateId: cand, status: 'finished', kind: 'interview' };
    expect(await resolveCallAccess(who, call)).toMatchObject({ access: 'summary' });
    await prisma.user.updateMany({ where: { candidateId: cand }, data: { blockedAt: new Date(), blockedUntil: null } });
    await expect(resolveCallAccess(who, call)).rejects.toMatchObject({ status: 404 });
    await prisma.user.updateMany({ where: { candidateId: cand }, data: { blockedUntil: new Date() } }); // разблокировка
    expect(await resolveCallAccess(who, call)).toMatchObject({ access: 'summary' });
  });
});
