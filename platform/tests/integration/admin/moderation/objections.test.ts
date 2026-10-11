// E-08, фаза 2: возражения против автоматической оценки (152-ФЗ, ст. 16) – перенос из dev-панели в админку.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as listGet } from '@/app/api/admin/objections/route';
import { POST as decidePost } from '@/app/api/admin/objections/[id]/route';
import { mailOutbox } from '@/server/mail';

import { jsonRequest } from '../../../helpers/requests';

import { auditRows, DEMO_POOL, flush, params, prisma, setupWorld, staffSession, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const CAND = DEMO_POOL[0]!.id;
const decide = (id: string, cookie: string, body: unknown) => decidePost(jsonRequest(`/api/admin/objections/${id}`, 'POST', body, cookie), params(id));

async function attemptWithCategory() {
  const finishedAt = new Date(Date.now() - 86_400_000);
  const a = await prisma.testAttempt.create({
    data: { candidateId: CAND, specialization: 'backend', grade: 'middle', status: 'passed', seed: 1, policyVersion: 'test', expiresAt: finishedAt, finishedAt, theta: 1.1, pPass: 0.9 },
  });
  const older = await prisma.candidateCategory.create({ data: { candidateId: CAND, specialization: 'backend', grade: 'junior', confirmedAt: new Date(Date.now() - 90 * 86_400_000) } });
  const cat = await prisma.candidateCategory.create({ data: { candidateId: CAND, specialization: 'backend', grade: 'middle', confirmedAt: finishedAt } });
  return { a, cat, older };
}

const objection = (subject: 'grade_test' | 'call' | 'defense', subjectId: string, createdAt = new Date()) =>
  prisma.assessmentObjection.create({ data: { candidateId: CAND, subject, subjectId, text: 'Не согласен с оценкой, задания были не по моему стеку', createdAt } });

describe('admin: возражения (ст. 16 152-ФЗ)', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('модератор без права – 403 на очередь и ответ; поддержка видит открытые по сроку с предметом', async () => {
    const { a } = await attemptWithCategory();
    const late = await objection('grade_test', a.id, new Date(Date.now() - 2 * 86_400_000));
    const early = await objection('grade_test', a.id, new Date(Date.now() - 29 * 86_400_000));
    expect((await listGet(jsonRequest('/api/admin/objections', 'GET', undefined, staff.moderator.cookie))).status).toBe(403);
    expect((await decide(late.id, staff.moderator.cookie, { decision: 'answer', text: 'Ответ модератора' })).status).toBe(403);

    const body = await (await listGet(jsonRequest('/api/admin/objections', 'GET', undefined, staff.support.cookie))).json();
    expect(body.objections.map((o: { id: string }) => o.id)).toEqual([early.id, late.id]);
    expect(body.objections[0].hoursLeft).toBeLessThan(48);
    expect(body.objections[0].preview).toMatchObject({ found: true, attemptId: a.id });
    expect(body.objections[0].candidate).toMatch(/^Кандидат #/);
  });

  it('answer: статус answered, answeredById, журнал, письмо кандидату; повтор – 409; без текста – 400', async () => {
    const o = await objection('call', 'missing-call');
    expect((await decide(o.id, staff.support.cookie, { decision: 'answer', text: '' })).status).toBe(400);
    const r = await decide(o.id, staff.support.cookie, { decision: 'answer', text: 'Оценку созвона перепроверили, она верна' });
    expect(r.status).toBe(200);
    expect(await prisma.assessmentObjection.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'answered', answeredById: staff.support.id, answer: 'Оценку созвона перепроверили, она верна' });
    expect((await auditRows(o.id))[0]).toMatchObject({ action: 'answer_objection.answer', actorId: staff.support.id, targetType: 'objection' });
    await flush();
    expect(mailOutbox().some((m) => m.kind === 'objection_answer' && m.to === `${CAND}@example.test`)).toBe(true);
    expect((await decide(o.id, staff.support.cookie, { decision: 'answer', text: 'Ещё один ответ' })).status).toBe(409);
  });

  it('review: остаётся открытым, итог от того же сотрудника – 409, от другого – 200', async () => {
    const o = await objection('defense', 'missing-defense');
    const r = await decide(o.id, staff.support.cookie, { decision: 'review', text: 'Прошу коллегу пересмотреть вердикт' });
    expect(r.status).toBe(200);
    expect((await prisma.assessmentObjection.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('open');
    expect((await decide(o.id, staff.support.cookie, { decision: 'review', text: 'Второй раз назначаю' })).status).toBe(409);
    expect((await decide(o.id, staff.support.cookie, { decision: 'answer', text: 'Сам себе отвечаю' })).status).toBe(409);
    const q = await (await listGet(jsonRequest('/api/admin/objections', 'GET', undefined, staff.support.cookie))).json();
    expect(q.objections[0].review).toMatchObject({ assignedById: staff.support.id });
    const other = await staffSession('support', 2);
    expect((await decide(o.id, other.cookie, { decision: 'answer', text: 'Пересмотрел: оценка подтверждается' })).status).toBe(200);
    expect((await auditRows(o.id)).map((x) => x.action)).toEqual(['answer_objection.review', 'answer_objection.answer']);
  });

  it('annul: попытка abandoned с отметкой, категория по попытке снята (старая осталась), журнал; не тест – 409', async () => {
    const { a, cat, older } = await attemptWithCategory();
    const o = await objection('grade_test', cat.id);
    const r = await decide(o.id, staff.support.cookie, { decision: 'annul', text: 'Задания выдались не по подкатегории, попытка аннулирована' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ annulledAttemptId: a.id, removedCategories: 1 });
    const after = await prisma.testAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe('abandoned');
    expect((after.integrity as { annulled: { byStaffId: string } }).annulled.byStaffId).toBe(staff.support.id);
    expect(await prisma.candidateCategory.findUnique({ where: { id: cat.id } })).toBeNull();
    expect(await prisma.candidateCategory.findUnique({ where: { id: older.id } })).not.toBeNull();
    expect(await prisma.adminAuditLog.count({ where: { action: 'answer_objection.annul_attempt', targetId: CAND } })).toBe(1);
    expect((await auditRows(o.id))[0]).toMatchObject({ action: 'answer_objection.annul' });
    await flush();
    expect(mailOutbox().some((m) => m.kind === 'objection_answer' && /аннулирована/.test(m.subject))).toBe(true);

    const c = await objection('call', 'missing-call');
    expect((await decide(c.id, staff.support.cookie, { decision: 'annul', text: 'Пытаюсь аннулировать созвон' })).status).toBe(409);
  });
});
