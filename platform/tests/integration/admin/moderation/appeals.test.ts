// E-08, фаза 2: апелляция работодателя на санкцию – кабинет → очередь → решение (под lock отправки), журнал, письма.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as listGet } from '@/app/api/admin/appeals/route';
import { POST as resolvePost } from '@/app/api/admin/appeals/[id]/route';
import { GET as myAppeals, POST as appealPost } from '@/app/api/employer/sanction-appeal/route';
import { companySanction } from '@/server/employer';
import { mailOutbox } from '@/server/mail';

import { jsonRequest } from '../../../helpers/requests';

import { auditRows, ctxEmp, DEMO_EMPLOYER, EMP, flush, params, prisma, seedComplaints, setupWorld, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const TEXT = 'Жалобы пришли от кандидатов, которых мы не приглашали массово';
const appeal = (text = TEXT) => appealPost(jsonRequest('/api/employer/sanction-appeal', 'POST', { text }, EMP));
const decide = (id: string, cookie: string, body: unknown) => resolvePost(jsonRequest(`/api/admin/appeals/${id}`, 'POST', body, cookie), params(id));

describe('admin: апелляции на санкцию', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('работодатель: без санкции – 409; с санкцией – 201; вторая открытая – 409; короткий текст – 400; видит свои', async () => {
    expect((await appeal()).status).toBe(409);
    await seedComplaints(3);
    expect((await appeal('коротко')).status).toBe(400);
    const r = await appeal();
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ status: 'open', text: TEXT });
    expect((await appeal()).status).toBe(409);
    const mine = await (await myAppeals(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(mine.appeals).toHaveLength(1);
    expect(await prisma.sanctionAppeal.findFirstOrThrow()).toMatchObject({ companyId: ctxEmp.companyId, authorId: DEMO_EMPLOYER.profileId });
  });

  it('support – 403 на очередь и решение', async () => {
    await seedComplaints(3);
    const { id } = await (await appeal()).json();
    expect((await listGet(jsonRequest('/api/admin/appeals', 'GET', undefined, staff.support.cookie))).status).toBe(403);
    expect((await decide(id, staff.support.cookie, { decision: 'upheld', reason: 'Апелляция обоснована' })).status).toBe(403);
    expect((await prisma.sanctionAppeal.findUniqueOrThrow({ where: { id } })).status).toBe('open');
  });

  it('upheld: открытые жалобы отклонены, подтверждённая осталась, санкция снята; журнал на апелляцию и жалобы; письма', async () => {
    const open = await seedComplaints(3);
    const [kept] = await seedComplaints(1, 'upheld', 3);
    expect((await companySanction(ctxEmp.companyId)).level).toBe('reduced');
    const { id } = await (await appeal()).json();

    const q = await (await listGet(jsonRequest('/api/admin/appeals', 'GET', undefined, staff.moderator.cookie))).json();
    expect(q.appeals[0]).toMatchObject({ id, sanction: { level: 'reduced', complaints: 4 } });
    expect(q.appeals[0].complaints).toHaveLength(4);

    expect((await decide(id, staff.moderator.cookie, { decision: 'upheld', reason: '' })).status).toBe(400);
    expect((await decide(id, staff.moderator.cookie, { decision: 'upheld', reason: 'x', complaintIds: [kept] })).status).toBe(400);
    const r = await decide(id, staff.moderator.cookie, { decision: 'upheld', reason: 'Жалобы шаблонные, от одной группы', complaintIds: [kept] });
    expect(r.status).toBe(400); // подтверждённую жалобу апелляцией не снять
    const ok = await decide(id, staff.moderator.cookie, { decision: 'upheld', reason: 'Жалобы шаблонные, от одной группы' });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ status: 'upheld', sanctionBefore: { level: 'reduced' }, sanctionAfter: { level: 'none', complaints: 1 } });
    expect(body.dismissedComplaintIds.sort()).toEqual([...open].sort());
    expect(await prisma.complaint.count({ where: { id: { in: open }, status: 'dismissed' } })).toBe(3);
    expect((await prisma.complaint.findUniqueOrThrow({ where: { id: kept! } })).status).toBe('upheld');

    expect((await auditRows(id)).map((a) => a.action)).toEqual(['resolve_appeal.upheld']);
    expect((await auditRows(open[0]!)).map((a) => a.action)).toEqual(['resolve_appeal.dismiss_complaint']);
    await flush();
    expect(mailOutbox().filter((m) => m.kind === 'appeal_outcome' && m.to === DEMO_EMPLOYER.email)).toHaveLength(1);
    expect(mailOutbox().filter((m) => m.kind === 'complaint_outcome')).toHaveLength(3);

    expect((await decide(id, staff.moderator.cookie, { decision: 'rejected', reason: 'Повторное решение' })).status).toBe(409);
  });

  it('rejected: санкция не меняется, журнал resolve_appeal.rejected, письмо работодателю', async () => {
    await seedComplaints(3);
    const { id } = await (await appeal()).json();
    const r = await decide(id, staff.owner.cookie, { decision: 'rejected', reason: 'Жалобы подтверждаются текстами приглашений' });
    expect(r.status).toBe(200);
    expect((await companySanction(ctxEmp.companyId)).level).toBe('reduced');
    expect((await auditRows(id))[0]).toMatchObject({ action: 'resolve_appeal.rejected', actorId: staff.owner.id });
    await flush();
    expect(mailOutbox().some((m) => m.kind === 'appeal_outcome')).toBe(true);
  });
});
