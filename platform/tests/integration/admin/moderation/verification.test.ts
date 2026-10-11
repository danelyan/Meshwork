// E-08, фаза 2: ручная верификация компании – запрос из кабинета → очередь → решение, метка на приглашении кандидата.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as listGet } from '@/app/api/admin/verification/route';
import { POST as decidePost } from '@/app/api/admin/verification/[id]/route';
import { GET as statusGet, POST as requestPost } from '@/app/api/employer/company/verification/route';
import { listCandidateInvitations } from '@/server/employer/invitations';
import { createInvitation } from '@/server/employer/invitations';

import { jsonRequest } from '../../../helpers/requests';

import { auditRows, ctxEmp, DEMO_EMPLOYER, DEMO_POOL, EMP, params, prisma, setupWorld, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const CO = ctxEmp.companyId;
const ask = (body: unknown) => requestPost(jsonRequest('/api/employer/company/verification', 'POST', body, EMP));
const decide = (cookie: string, body: unknown) => decidePost(jsonRequest(`/api/admin/verification/${CO}`, 'POST', body, cookie), params(CO));
const EGRUL = { method: 'egrul', text: 'ОГРН 1027700132195, выписка от 01.10.2026, nalog.ru' };

describe('admin: верификация компаний', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('кабинет: без ИНН – 409; короткие реквизиты – 400; бесплатная почта – 400; выписка – запрос принят', async () => {
    expect((await ask(EGRUL)).status).toBe(409);
    await prisma.company.update({ where: { id: CO }, data: { inn: '7707083893' } });
    expect((await ask({ method: 'egrul', text: 'коротко' })).status).toBe(400);
    await prisma.user.update({ where: { id: DEMO_EMPLOYER.userId }, data: { email: 'hr@gmail.com', emailVerifiedAt: new Date() } });
    expect((await ask({ method: 'email_domain' })).status).toBe(400);
    const r = await ask(EGRUL);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ verified: false, requestedAt: expect.any(String), evidence: { method: 'egrul' } });
    const st = await (await statusGet(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(st.requestedAt).toBeTruthy();
  });

  it('домен корпоративной почты берётся из подтверждённой почты аккаунта', async () => {
    await prisma.company.update({ where: { id: CO }, data: { inn: '7707083893' } });
    await prisma.user.update({ where: { id: DEMO_EMPLOYER.userId }, data: { email: 'hr@northstream.ru', emailVerifiedAt: new Date() } });
    const r = await ask({ method: 'email_domain', text: '' });
    expect(r.status).toBe(200);
    expect((await r.json()).evidence).toMatchObject({ method: 'email_domain', domain: 'northstream.ru' });
  });

  it('support – 403; модератор: verify → метка у кандидата на приглашении, журнал; повтор – 409; revoke снимает', async () => {
    await prisma.company.update({ where: { id: CO }, data: { inn: '7707083893' } });
    await ask(EGRUL);
    expect((await listGet(jsonRequest('/api/admin/verification', 'GET', undefined, staff.support.cookie))).status).toBe(403);
    expect((await decide(staff.support.cookie, { decision: 'verify', reason: 'ИНН и название сверены' })).status).toBe(403);

    const q = await (await listGet(jsonRequest('/api/admin/verification', 'GET', undefined, staff.moderator.cookie))).json();
    expect(q.companies).toEqual([expect.objectContaining({ companyId: CO, innValid: true, evidence: expect.objectContaining({ method: 'egrul' }) })]);

    const inv = await createInvitation(ctxEmp, { candidateId: DEMO_POOL[0]!.id, message: 'Платёжная команда, Go и Kafka, высокая нагрузка, код-ревью и дежурства', salaryFrom: 200000, salaryTo: 260000 });
    expect((await listCandidateInvitations(DEMO_POOL[0]!.id)).find((i) => i.id === inv.id)!.company.verified).toBe(false);

    expect((await decide(staff.moderator.cookie, { decision: 'verify', reason: 'ИНН и название сверены с выпиской' })).status).toBe(200);
    expect(await prisma.company.findUniqueOrThrow({ where: { id: CO } })).toMatchObject({ verifiedById: staff.moderator.id, verificationNote: 'ИНН и название сверены с выпиской' });
    expect((await listCandidateInvitations(DEMO_POOL[0]!.id)).find((i) => i.id === inv.id)!.company.verified).toBe(true);
    expect((await auditRows(CO))[0]).toMatchObject({ action: 'verify_company.verify', targetType: 'company', actorId: staff.moderator.id });

    expect((await decide(staff.moderator.cookie, { decision: 'verify', reason: 'Повторно подтверждаю' })).status).toBe(409);
    expect((await decide(staff.moderator.cookie, { decision: 'revoke', reason: 'Выписка оказалась чужой' })).status).toBe(200);
    expect((await listCandidateInvitations(DEMO_POOL[0]!.id)).find((i) => i.id === inv.id)!.company.verified).toBe(false);
  });

  it('reject: запрос снят, причина видна представителю, журнал', async () => {
    await prisma.company.update({ where: { id: CO }, data: { inn: '7707083893' } });
    await ask(EGRUL);
    expect((await decide(staff.owner.cookie, { decision: 'reject', reason: 'Название в выписке не совпадает' })).status).toBe(200);
    const st = await (await statusGet(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(st).toMatchObject({ verified: false, requestedAt: null, note: 'Название в выписке не совпадает' });
    expect((await auditRows(CO))[0]).toMatchObject({ action: 'verify_company.reject' });
  });
});
