// E-08, фаза 2: красные флаги → очередь (идемпотентно) → ok/hidden/warned; скрытая вакансия не видна кандидатам.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as listGet } from '@/app/api/admin/red-flags/route';
import { POST as reviewPost } from '@/app/api/admin/red-flags/[id]/route';
import { detectRedFlags } from '@/server/employer/antifraud';
import { queueRedFlags } from '@/server/admin/moderation/red-flags';
import { createApplication } from '@/server/employer/applications';
import { createInvitation } from '@/server/employer/invitations';
import { VacancyInput } from '@/server/employer/schemas';
import { createVacancy } from '@/server/employer/vacancies';
import { mailOutbox } from '@/server/mail';
import { careerVacancies } from '@/server/recommend/career';
import { consentVersion } from '@/server/consent/texts';

import { jsonRequest } from '../../../helpers/requests';

import { auditRows, ctxEmp, DEMO_EMPLOYER, DEMO_POOL, flush, params, prisma, setupWorld, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const review = (id: string, cookie: string, body: unknown) => reviewPost(jsonRequest(`/api/admin/red-flags/${id}`, 'POST', body, cookie), params(id));
const SCAM = 'Стажировка в команде платформы. Для начала работы нужно оплатить обучение на курсе и внести вступительный взнос, дальше доход без опыта.';

async function scamVacancy() {
  return createVacancy(
    ctxEmp.companyId,
    VacancyInput.parse({ title: 'Стажёр backend', specialization: 'backend', grade: 'junior', salaryFrom: 90000, salaryTo: 120000, description: SCAM, subcategoryId: 'backend.web-api', needs: [{ catalogId: 'be.rest-design', weight: 1 }] }),
  );
}

describe('admin: красные флаги', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('приглашение с флагом попадает в очередь; чистое — нет; повторная постановка идемпотентна', async () => {
    const clean = await createInvitation(ctxEmp, { candidateId: DEMO_POOL[0]!.id, message: 'Платёжная команда, Go и Kafka, высокая нагрузка, код-ревью и дежурства', salaryFrom: 200000, salaryTo: 260000 });
    const bad = await createInvitation(ctxEmp, { candidateId: DEMO_POOL[1]!.id, message: SCAM, salaryFrom: 200000, salaryTo: 260000 });
    expect(await prisma.redFlagReview.count({ where: { targetId: clean.id } })).toBe(0);
    const row = await prisma.redFlagReview.findUniqueOrThrow({ where: { targetType_targetId: { targetType: 'invitation', targetId: bad.id } } });
    expect((row.flags as { code: string }[]).map((f) => f.code)).toContain('payment_request');
    await queueRedFlags('invitation', bad.id, detectRedFlags({ texts: [SCAM], salaryFrom: 200000, salaryTo: 260000 }));
    await Promise.all([1, 2, 3].map(() => queueRedFlags('invitation', bad.id, detectRedFlags({ texts: [SCAM], salaryFrom: 200000, salaryTo: 260000 })).catch(() => undefined)));
    expect(await prisma.redFlagReview.count({ where: { targetId: bad.id } })).toBe(1);
  });

  it('support — 403; hidden для приглашения — 400; warned — письмо представителю и журнал', async () => {
    const bad = await createInvitation(ctxEmp, { candidateId: DEMO_POOL[1]!.id, message: SCAM, salaryFrom: 200000, salaryTo: 260000 });
    const { id } = await prisma.redFlagReview.findFirstOrThrow({ where: { targetId: bad.id } });
    expect((await listGet(jsonRequest('/api/admin/red-flags', 'GET', undefined, staff.support.cookie))).status).toBe(403);
    expect((await review(id, staff.support.cookie, { decision: 'ok', reason: 'Всё нормально' })).status).toBe(403);
    expect((await review(id, staff.moderator.cookie, { decision: 'hidden', reason: 'Скрыть приглашение' })).status).toBe(400);
    const r = await review(id, staff.moderator.cookie, { decision: 'warned', reason: 'Просьба оплатить обучение недопустима' });
    expect(r.status).toBe(200);
    expect(await prisma.redFlagReview.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'warned', resolvedById: staff.moderator.id });
    expect((await auditRows(bad.id))[0]).toMatchObject({ action: 'review_red_flag.warned', targetType: 'invitation' });
    await flush();
    expect(mailOutbox().some((m) => m.kind === 'red_flag_warning' && m.to === DEMO_EMPLOYER.email)).toBe(true);
    expect((await review(id, staff.moderator.cookie, { decision: 'ok', reason: 'Повторное решение' })).status).toBe(409);
  });

  it('вакансия с флагом → hidden: пропадает из каталога кандидата, отклик — 404; журнал', async () => {
    const v = await scamVacancy();
    const rv = await prisma.redFlagReview.findUniqueOrThrow({ where: { targetType_targetId: { targetType: 'vacancy', targetId: v.id } } });
    const cand = DEMO_POOL[2]!.id;
    expect((await careerVacancies(cand)).targets.some((t) => t.vacancyId === v.id)).toBe(true);
    const q = await (await listGet(jsonRequest('/api/admin/red-flags', 'GET', undefined, staff.moderator.cookie))).json();
    expect(q.redFlags.find((x: { id: string }) => x.id === rv.id)).toMatchObject({ targetType: 'vacancy', company: { id: ctxEmp.companyId } });

    expect((await review(rv.id, staff.moderator.cookie, { decision: 'hidden', reason: 'Платное обучение - типичная схема' })).status).toBe(200);
    expect((await careerVacancies(cand)).targets.some((t) => t.vacancyId === v.id)).toBe(false);
    await expect(createApplication(cand, v.id, { message: null, disclosureVersion: consentVersion('identity_disclosure') } as never)).rejects.toMatchObject({ status: 404 });
    expect((await auditRows(v.id))[0]).toMatchObject({ action: 'review_red_flag.hidden', targetType: 'vacancy', actorId: staff.moderator.id });
  });
});
