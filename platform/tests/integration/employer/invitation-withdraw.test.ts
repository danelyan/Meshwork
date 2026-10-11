// lane invite-cancel: отзыв приглашения работодателем (ТЗ 2.2 п. 3 — статус видят обе стороны; ADR 0008 п. 6 — отмена
// приглашения закрывает слоты живой защиты) и запрет вопроса к сабмиту чужой компании (ADR 0008, visibility.ts).
import { POST as questionRoute } from '@/app/api/employer/questions/route';
import { POST as proposeRoute } from '@/app/api/employer/invitations/[id]/live-defense/route';
import { POST as withdrawRoute } from '@/app/api/employer/invitations/[id]/withdraw/route';
import { GET as employerList, POST as inviteRoute } from '@/app/api/employer/invitations/route';
import { POST as chooseRoute } from '@/app/api/invitations/[id]/live-defense/choose/route';
import { GET as candidateList } from '@/app/api/invitations/route';
import { notifications } from '@/server/auth/notifications';
import { joinCall } from '@/server/defense-room/employer';
import { clearMailOutbox, mailOutbox } from '@/server/mail';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { discloseAccepted, grantConsents, grantEmployerConsents } from '../../helpers/consents';

const EMP_A = `cid=${signUserSession({ userId: 'u-emp-a', role: 'employer', employerProfileId: 'ep-a' })}`;
const EMP_B = `cid=${signUserSession({ userId: 'u-emp-b', role: 'employer', employerProfileId: 'ep-b' })}`;
const CAND = `cid=${signUserSession({ userId: 'u-c1', role: 'candidate', candidateId: 'c1' })}`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, cookie: string) => jsonRequest('/x', 'POST', body, cookie);
const withdraw = (inv: string, reason: string, cookie = EMP_A) => withdrawRoute(post({ reason }, cookie), params(inv));
const hoursFromNow = (h: number) => {
  const d = new Date(Date.now() + h * 3600_000);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
};

let INV: Record<string, string> = {};

async function seed() {
  for (const x of ['a', 'b']) {
    await prisma.company.create({ data: { id: `co-${x}`, name: x === 'a' ? 'Альфа' : 'Бета' } });
    await prisma.user.create({ data: { id: `u-emp-${x}`, name: `HR ${x}`, role: 'employer', email: `hr-${x}@example.com` } });
    await prisma.employerProfile.create({ data: { id: `ep-${x}`, userId: `u-emp-${x}`, companyId: `co-${x}` } });
  }
  await grantEmployerConsents(['u-emp-a', 'u-emp-b']);
  await prisma.candidate.create({ data: { id: 'c1', email: 'c1@example.com', name: 'Кандидат 1' } });
  await prisma.user.create({ data: { id: 'u-c1', name: 'c1', role: 'candidate', candidateId: 'c1' } });
  await grantConsents('u-c1', ['call_recording', 'ai_assessment']);
  const mk = async (companyId: string, status: 'accepted' | 'sent' | 'viewed' | 'declined' | 'hired', ep: string) =>
    (await prisma.invitation.create({ data: { candidateId: 'c1', companyId, employerProfileId: ep, status, salaryFrom: 200000, salaryTo: 250000 }, select: { id: true } })).id;
  INV = {
    accepted: await mk('co-a', 'accepted', 'ep-a'),
    sent: await mk('co-a', 'sent', 'ep-a'),
    declined: await mk('co-a', 'declined', 'ep-a'),
    hired: await mk('co-a', 'hired', 'ep-a'),
    b: await mk('co-b', 'accepted', 'ep-b'),
  };
  await discloseAccepted();
  await prisma.projectTemplate.create({ data: { id: 'tpl-1', subcategoryId: 'backend.integrations', specialization: 'backend', grade: 'middle', title: 'Платежи', contractMd: '#', dirRef: 'x', hiddenTestsRef: 'hidden', visibleTestsRef: 'visible', image: 'node20', timeBudgetMin: 240 } });
  for (const x of ['a', 'b']) {
    await prisma.vacancy.create({ data: { id: `vac-${x}`, companyId: `co-${x}`, title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 250000, needs: [] } });
    await prisma.projectTask.create({ data: { id: `task-${x}`, vacancyId: `vac-${x}`, templateId: 'tpl-1', specialization: 'backend', grade: 'middle', specJson: {}, rubricJson: { criteria: [] } } });
    await prisma.projectSubmission.create({ data: { id: `sub-${x}`, projectTaskId: `task-${x}`, candidateId: 'c1', repoUrl: `https://github.com/fsp-demo/payments-${x}`, status: 'checked', submittedAt: new Date(Date.now() - (x === 'a' ? 0 : 60_000)) } });
  }
}

describe('lane invite-cancel: отзыв приглашения работодателем (БД)', () => {
  beforeEach(async () => {
    await resetDb();
    clearMailOutbox();
    await seed();
  });
  afterAll(() => prisma.$disconnect());

  it('чужая компания — 404; hired и declined — 409; причина обязательна и до 300 знаков — 400', async () => {
    expect((await withdraw(INV.accepted!, 'Позиция закрыта', EMP_B)).status).toBe(404);
    for (const id of [INV.hired!, INV.declined!]) {
      const r = await withdraw(id, 'Позиция закрыта');
      expect(r.status).toBe(409);
      expect((await r.json()).error.code).toBe('invitation_not_withdrawable');
    }
    expect((await withdraw(INV.sent!, '  ')).status).toBe(400);
    expect((await withdraw(INV.sent!, 'x'.repeat(301))).status).toBe(400);
    expect(await prisma.invitation.count({ where: { status: 'withdrawn' } })).toBe(0);
  });

  it('sent → withdrawn: повторный отзыв — 409, лимит за сутки не возвращается', async () => {
    const before = await prisma.invitation.count({ where: { companyId: 'co-a' } });
    const r = await withdraw(INV.sent!, 'Позиция закрыта');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'withdrawn', withdrawn: { reason: 'Позиция закрыта' } });
    expect((await withdraw(INV.sent!, 'Ещё раз')).status).toBe(409);
    // Счётчик лимита — по createdAt всех приглашений компании, отозванное в нём остаётся.
    expect(await prisma.invitation.count({ where: { companyId: 'co-a', createdAt: { gt: new Date(Date.now() - 86_400_000) } } })).toBe(before);
    // lane lifecycle: после отзыва — пауза 14 дней (409 invite_cooldown), по её истечении можно пригласить снова.
    const blocked = await inviteRoute(post({ candidateId: 'c1', message: 'Вернулись к вакансии, приглашаем снова', salaryFrom: 200000, salaryTo: 250000 }, EMP_A));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatchObject({ code: 'invite_cooldown', details: { nextAt: expect.any(String) } });
    await prisma.invitation.update({ where: { id: INV.sent! }, data: { withdrawnAt: new Date(Date.now() - 15 * 86_400_000) } });
    const again = await inviteRoute(post({ candidateId: 'c1', message: 'Вернулись к вакансии, приглашаем снова', salaryFrom: 200000, salaryTo: 250000 }, EMP_A));
    expect(again.status).toBe(201);
  });

  it('accepted → withdrawn: слоты закрыты, выбор слота — 409, ожидающая сессия отменена, вход в комнату — 404, раскрытие отозвано', async () => {
    const view = await (await proposeRoute(post({ slots: [hoursFromNow(3), hoursFromNow(5)], durationMin: 45 }, EMP_A), params(INV.accepted!))).json();
    expect((await chooseRoute(post({ slotId: view.slots[0].id }, CAND), params(INV.accepted!))).status).toBe(200);
    const live = await prisma.liveDefense.findFirstOrThrow({ where: { invitationId: INV.accepted! } });
    expect(live.callSessionId).toBeTruthy();
    expect(await prisma.liveDefenseSlot.count({ where: { bookedKey: { not: null } } })).toBe(1);

    expect((await withdraw(INV.accepted!, 'Бюджет на позицию сняли')).status).toBe(200);

    const after = await prisma.liveDefense.findUniqueOrThrow({ where: { id: live.id } });
    expect(after).toMatchObject({ status: 'cancelled', cancelledBy: 'employer', cancelReason: 'Приглашение отозвано' });
    expect(await prisma.liveDefenseSlot.count({ where: { bookedKey: { not: null } } })).toBe(0);
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id: live.callSessionId! } })).status).toBe('cancelled');
    const chosen = await chooseRoute(post({ slotId: view.slots[1].id }, CAND), params(INV.accepted!));
    expect(chosen.status).toBe(409);
    await expect(joinCall({ userId: 'u-emp-a', role: 'employer', candidateId: null, employerProfileId: 'ep-a' }, live.callSessionId!)).rejects.toMatchObject({ status: 404 });
    // Раскрытие по этому приглашению отозвано, по приглашению компании B — действует.
    const disclosures = await prisma.consent.findMany({ where: { userId: 'u-c1', kind: 'identity_disclosure' }, select: { context: true, revokedAt: true } });
    const byInv = new Map(disclosures.map((d) => [(d.context as { invitationId?: string }).invitationId, d.revokedAt]));
    expect(byInv.get(INV.accepted!)).not.toBeNull();
    expect(byInv.get(INV.b!)).toBeNull();
    // Работодатель больше не видит имя и контакты.
    const emp = await (await employerList(jsonRequest('/x', 'GET', undefined, EMP_A))).json();
    const row = emp.invitations.find((i: { id: string }) => i.id === INV.accepted);
    expect(row).toMatchObject({ status: 'withdrawn', withdrawn: { reason: 'Бюджет на позицию сняли' } });
    expect(row.candidate.contacts).toBeNull();
  });

  it('кандидат видит статус и причину, уведомление в ленте и письмо', async () => {
    expect((await withdraw(INV.sent!, 'Позиция закрыта')).status).toBe(200);
    const mine = await (await candidateList(jsonRequest('/x', 'GET', undefined, CAND))).json();
    expect(mine.invitations.find((i: { id: string }) => i.id === INV.sent)).toMatchObject({ status: 'withdrawn', withdrawn: { reason: 'Позиция закрыта' } });
    const feed = await notifications({ userId: 'u-c1', role: 'candidate', candidateId: 'c1', employerProfileId: null });
    const item = feed.items.find((i) => i.id === `withdrawn-${INV.sent}`);
    expect(item).toMatchObject({ text: '«Альфа» отозвала приглашение', detail: 'Позиция закрыта', unread: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(mailOutbox().find((m) => m.kind === 'invitation_withdrawn')).toMatchObject({ to: 'c1@example.com' });
  });
});

describe('lane invite-cancel: вопрос с привязкой к сабмиту — только своей компании (БД)', () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  const ask = (projectSubmissionId?: string) => questionRoute(post({ candidateId: 'c1', text: 'Почему выбрали такую схему ретраев?', ...(projectSubmissionId ? { projectSubmissionId } : {}) }, EMP_A));

  it('к сабмиту под вакансию другой компании — 404 submission_not_owned; к своему и без привязки — 201', async () => {
    const foreign = await ask('sub-b');
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('submission_not_owned');
    expect((await ask('sub-a')).status).toBe(201);
    expect((await ask()).status).toBe(201);
    expect(await prisma.employerQuestion.count({ where: { companyId: 'co-a' } })).toBe(2);
  });
});
