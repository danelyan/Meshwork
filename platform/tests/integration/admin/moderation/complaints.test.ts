// E-08, фаза 2: очередь жалоб – права, причина, журнал, пересчёт санкции, письмо кандидату.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as listGet } from '@/app/api/admin/complaints/route';
import { POST as resolvePost } from '@/app/api/admin/complaints/[id]/route';
import { companySanction } from '@/server/employer';
import { createInvitation } from '@/server/employer/invitations';
import { mailOutbox } from '@/server/mail';

import { jsonRequest } from '../../../helpers/requests';

import { auditRows, ctxEmp, DEMO_POOL, flush, params, prisma, seedComplaints, setupWorld, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const decide = (id: string, cookie: string, body: unknown) => resolvePost(jsonRequest(`/api/admin/complaints/${id}`, 'POST', body, cookie), params(id));
const invite = (i: number) => createInvitation(ctxEmp, { candidateId: DEMO_POOL[i]!.id, message: 'Платёжная команда, Go и Kafka, высокая нагрузка, код-ревью и дежурства', salaryFrom: 200000, salaryTo: 260000 });

describe('admin: очередь жалоб', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('support без права: GET и POST – 403, без сессии – 401; жалоба не меняется', async () => {
    const [id] = await seedComplaints(1);
    expect((await listGet(jsonRequest('/api/admin/complaints', 'GET', undefined, staff.support.cookie))).status).toBe(403);
    expect((await decide(id!, staff.support.cookie, { decision: 'dismissed', reason: 'Проверено, жалоба ложная' })).status).toBe(403);
    expect((await decide(id!, '', { decision: 'dismissed', reason: 'Проверено, жалоба ложная' })).status).toBe(401);
    expect((await prisma.complaint.findUniqueOrThrow({ where: { id: id! } })).status).toBe('open');
    expect(await prisma.adminAuditLog.count({ where: { targetId: id! } })).toBe(0);
  });

  it('модератор видит очередь с историей компании; без причины – 400', async () => {
    const [id] = await seedComplaints(3);
    const body = await (await listGet(jsonRequest('/api/admin/complaints', 'GET', undefined, staff.moderator.cookie))).json();
    expect(body.complaints).toHaveLength(3);
    expect(body.complaints[0]).toMatchObject({ company: { id: ctxEmp.companyId }, companyHistory: { open: 3 }, sanction: { level: 'reduced' } });
    expect(body.complaints[0].candidate).toMatch(/^Кандидат #/);
    expect((await decide(id!, staff.moderator.cookie, { decision: 'dismissed', reason: '' })).status).toBe(400);
  });

  it('dismissed при блоке: санкция пересчитана сразу, отправка открылась, журнал и письмо; повтор – 409', async () => {
    const ids = await seedComplaints(5);
    expect((await companySanction(ctxEmp.companyId)).level).toBe('blocked');
    await expect(invite(6)).rejects.toMatchObject({ code: 'company_blocked' });

    const r = await decide(ids[0]!, staff.moderator.cookie, { decision: 'dismissed', reason: 'Кандидат сам откликался, спама нет' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'dismissed', sanctionBefore: { level: 'blocked' }, sanctionAfter: { level: 'reduced', complaints: 4 } });
    const row = await prisma.complaint.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(row).toMatchObject({ status: 'dismissed', resolvedById: staff.moderator.id, resolution: 'Кандидат сам откликался, спама нет' });
    expect(row.resolvedAt).toBeInstanceOf(Date);

    const log = await auditRows(ids[0]!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: staff.moderator.id, action: 'resolve_complaint.dismissed', targetType: 'complaint', reason: 'Кандидат сам откликался, спама нет' });
    expect((log[0]!.before as { status: string }).status).toBe('open');
    expect((log[0]!.after as { sanction: { level: string } }).sanction.level).toBe('reduced');

    await expect(invite(6)).resolves.toMatchObject({ status: 'sent' });
    await flush();
    expect(mailOutbox().some((m) => m.kind === 'complaint_outcome' && m.to === `${DEMO_POOL[0]!.id}@example.test`)).toBe(true);

    expect((await decide(ids[0]!, staff.moderator.cookie, { decision: 'upheld', reason: 'Передумал, подтверждаю' })).status).toBe(409);
    expect(await prisma.adminAuditLog.count({ where: { targetId: ids[0]! } })).toBe(1);
  });

  it('upheld: жалоба остаётся в санкции, журнал resolve_complaint.upheld; owner тоже может', async () => {
    const [id] = await seedComplaints(1);
    const r = await decide(id!, staff.owner.cookie, { decision: 'upheld', reason: 'Массовая рассылка подтверждена' });
    expect(r.status).toBe(200);
    expect((await companySanction(ctxEmp.companyId)).complaints).toBe(1);
    expect((await auditRows(id!))[0]).toMatchObject({ action: 'resolve_complaint.upheld', actorId: staff.owner.id });
  });
});
