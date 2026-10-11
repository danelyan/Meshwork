// lane live-slots (ADR 0008, «Назначение живой защиты: слоты»): права, окно, согласие на запись, гонка выбора, комната.
import { POST as employerCancelRoute } from '@/app/api/employer/invitations/[id]/live-defense/cancel/route';
import { POST as proposeRoute } from '@/app/api/employer/invitations/[id]/live-defense/route';
import { GET as employerList } from '@/app/api/employer/invitations/route';
import { POST as candidateCancelRoute } from '@/app/api/invitations/[id]/live-defense/cancel/route';
import { POST as chooseRoute } from '@/app/api/invitations/[id]/live-defense/choose/route';
import { POST as noneFitRoute } from '@/app/api/invitations/[id]/live-defense/none-fit/route';
import { GET as candidateList } from '@/app/api/invitations/route';
import { notifications } from '@/server/auth/notifications';
import { CALL_RECORDING_CONSENT_VERSION } from '@/server/call/consent';
import { joinCall } from '@/server/defense-room/employer';
import { loadCompanyTrusts } from '@/server/employer/company';
import { markInvitationHired } from '@/server/employer/invitations';
import { assertLiveRoomOpen, cancelLiveDefense, chooseSlot, proposeSlots } from '@/server/live-defense';
import { clearMailOutbox, mailOutbox } from '@/server/mail';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { discloseAccepted, grantConsents, grantEmployerConsents } from '../../helpers/consents';

const EMP_A = `cid=${signUserSession({ userId: 'u-emp-a', role: 'employer', employerProfileId: 'ep-a' })}`;
const EMP_B = `cid=${signUserSession({ userId: 'u-emp-b', role: 'employer', employerProfileId: 'ep-b' })}`;
const cand = (n: 1 | 2 | 3 | 4) => `cid=${signUserSession({ userId: `u-c${n}`, role: 'candidate', candidateId: `c${n}` })}`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, cookie: string) => jsonRequest('/x', 'POST', body, cookie);
const hoursFromNow = (h: number) => {
  const d = new Date(Date.now() + h * 3600_000);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
};

const propose = (inv: string, slots: string[], cookie = EMP_A, durationMin = 45) => proposeRoute(post({ slots, durationMin, comment: 'Обсудим ваш проект' }, cookie), params(inv));
const choose = (inv: string, slotId: string, cookie: string, recordingConsentVersion?: string) => chooseRoute(post({ slotId, ...(recordingConsentVersion ? { recordingConsentVersion } : {}) }, cookie), params(inv));

let INV: Record<string, string> = {};

async function seed() {
  for (const x of ['a', 'b']) {
    await prisma.company.create({ data: { id: `co-${x}`, name: x === 'a' ? 'Альфа' : 'Бета' } });
    await prisma.user.create({ data: { id: `u-emp-${x}`, name: `HR ${x}`, role: 'employer', email: `hr-${x}@example.com` } });
    await prisma.employerProfile.create({ data: { id: `ep-${x}`, userId: `u-emp-${x}`, companyId: `co-${x}` } });
  }
  await grantEmployerConsents(['u-emp-a', 'u-emp-b']);
  for (const n of [1, 2, 3, 4] as const) {
    await prisma.candidate.create({ data: { id: `c${n}`, email: `c${n}@example.com`, name: `Кандидат ${n}` } });
    await prisma.user.create({ data: { id: `u-c${n}`, name: `c${n}`, role: 'candidate', candidateId: `c${n}` } });
  }
  // c1, c2 — согласие на запись есть; c3 — нет.
  await grantConsents('u-c1', ['call_recording', 'ai_assessment']);
  await grantConsents('u-c2', ['call_recording', 'ai_assessment']);
  const mk = async (candidateId: string, companyId: string, status: 'accepted' | 'sent', ep: string) =>
    (await prisma.invitation.create({ data: { candidateId, companyId, employerProfileId: ep, status, salaryFrom: 200000, salaryTo: 250000 }, select: { id: true } })).id;
  INV = {
    a1: await mk('c1', 'co-a', 'accepted', 'ep-a'),
    a2: await mk('c2', 'co-a', 'accepted', 'ep-a'),
    a3: await mk('c3', 'co-a', 'accepted', 'ep-a'),
    a4: await mk('c4', 'co-a', 'accepted', 'ep-a'),
    aSent: await mk('c1', 'co-a', 'sent', 'ep-a'),
    b1: await mk('c1', 'co-b', 'accepted', 'ep-b'),
  };
  await discloseAccepted();
  // c1 сдал проект под потребность компании A — к нему привяжется сессия живой защиты.
  await prisma.projectTemplate.create({ data: { id: 'tpl-1', subcategoryId: 'backend.integrations', specialization: 'backend', grade: 'middle', title: 'Платежи', contractMd: '#', dirRef: 'x', hiddenTestsRef: 'hidden', visibleTestsRef: 'visible', image: 'node20', timeBudgetMin: 240 } });
  await prisma.vacancy.create({ data: { id: 'vac-1', companyId: 'co-a', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 250000, needs: [] } });
  await prisma.projectTask.create({ data: { id: 'task-1', vacancyId: 'vac-1', templateId: 'tpl-1', specialization: 'backend', grade: 'middle', specJson: {}, rubricJson: { criteria: [] } } });
  for (const n of [2, 3]) await prisma.projectSubmission.create({ data: { id: `sub-${n}`, projectTaskId: 'task-1', candidateId: `c${n}`, repoUrl: `https://github.com/fsp-demo/p${n}`, status: 'checked' } });
  // c4 проекта не сдавал.
  await prisma.projectSubmission.create({ data: { id: 'sub-1', projectTaskId: 'task-1', candidateId: 'c1', repoUrl: 'https://github.com/fsp-demo/payments', status: 'checked' } });
}

describe('lane live-slots: назначение живой защиты (БД)', () => {
  beforeEach(async () => {
    await resetDb();
    clearMailOutbox();
    await seed();
  });
  afterAll(() => prisma.$disconnect());

  it('права: чужая компания — 404, не accepted — 409, кандидат чужого приглашения — 404', async () => {
    const slots = [hoursFromNow(3), hoursFromNow(5)];
    expect((await propose(INV.a1!, slots, EMP_B)).status).toBe(404);
    const notAccepted = await propose(INV.aSent!, slots);
    expect(notAccepted.status).toBe(409);
    expect((await notAccepted.json()).error.code).toBe('invitation_not_accepted');
    const ok = await propose(INV.a1!, slots);
    expect(ok.status).toBe(201);
    const view = await ok.json();
    expect(view).toMatchObject({ status: 'slots_proposed', durationMin: 45, slots: [{ available: true }, { available: true }] });
    expect((await choose(INV.a1!, view.slots[0].id, cand(2))).status).toBe(404);
    expect((await noneFitRoute(post({ comment: 'неудобно' }, cand(2)), params(INV.a1!))).status).toBe(404);
  });

  it('лимит 2–5 и окно [now+2ч, now+14д] — 400', async () => {
    expect((await propose(INV.a1!, [hoursFromNow(3)])).status).toBe(400);
    expect((await propose(INV.a1!, [3, 4, 5, 6, 7, 8].map(hoursFromNow))).status).toBe(400);
    const early = await propose(INV.a1!, [hoursFromNow(1), hoursFromNow(5)]);
    expect(early.status).toBe(400);
    expect((await early.json()).error.code).toBe('slot_window');
    expect((await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(15 * 24)])).status).toBe(400);
    expect((await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(5)], EMP_A, 60)).status).toBe(400);
    expect((await propose(INV.a1!, [3, 4, 5, 6, 7].map(hoursFromNow))).status).toBe(201);
  });

  it('новое предложение заменяет старое: одно активное на приглашение', async () => {
    const first = await (await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(5)])).json();
    const second = await (await propose(INV.a1!, [hoursFromNow(6), hoursFromNow(8)])).json();
    expect(second.id).not.toBe(first.id);
    expect(await prisma.liveDefense.count({ where: { invitationId: INV.a1!, activeKey: { not: null } } })).toBe(1);
    // Старый слот больше не выбрать.
    expect((await choose(INV.a1!, first.slots[0].id, cand(1))).status).toBe(404);
  });

  it('без согласия на запись — 409 recording_consent_required; с версией — согласие записано и слот выбран', async () => {
    const view = await (await propose(INV.a3!, [hoursFromNow(3), hoursFromNow(5)])).json();
    const r = await choose(INV.a3!, view.slots[0].id, cand(3));
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toMatchObject({ code: 'recording_consent_required', details: { version: CALL_RECORDING_CONSENT_VERSION } });
    expect(await prisma.liveDefense.findFirstOrThrow({ where: { invitationId: INV.a3! } })).toMatchObject({ status: 'slots_proposed' });
    const ok = await choose(INV.a3!, view.slots[0].id, cand(3), CALL_RECORDING_CONSENT_VERSION);
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe('scheduled');
    expect(await prisma.consent.count({ where: { userId: 'u-c3', kind: 'call_recording', revokedAt: null } })).toBe(1);
  });

  it('гонка: два кандидата одновременно выбирают одно время компании — один 200, второй 409 slot_taken', async () => {
    const t = hoursFromNow(4);
    const v1 = await (await propose(INV.a1!, [t, hoursFromNow(6)])).json();
    const v2 = await (await propose(INV.a2!, [t, hoursFromNow(8)])).json();
    const [r1, r2] = await Promise.all([choose(INV.a1!, v1.slots[0].id, cand(1)), choose(INV.a2!, v2.slots[0].id, cand(2))]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect((await loser.json()).error.code).toBe('slot_taken');
    expect(await prisma.liveDefenseSlot.count({ where: { bookedKey: { not: null } } })).toBe(1);
    expect(await prisma.liveDefense.count({ where: { status: 'scheduled' } })).toBe(1);
  });

  it('пересечение (не то же время) тоже занято; слот проигравшего виден как недоступный, второй слот — выбирается', async () => {
    const v1 = await (await propose(INV.a1!, [hoursFromNow(4), hoursFromNow(6)])).json();
    const v2 = await (await propose(INV.a2!, [new Date(Date.parse(hoursFromNow(4)) + 30 * 60_000).toISOString(), hoursFromNow(8)])).json();
    expect((await choose(INV.a1!, v1.slots[0].id, cand(1))).status).toBe(200);
    const mine = await (await candidateList(jsonRequest('/x', 'GET', undefined, cand(2)))).json();
    const live = mine.invitations.find((i: { id: string }) => i.id === INV.a2).liveDefense;
    expect(live.slots.map((s: { available: boolean }) => s.available)).toEqual([false, true]);
    const r = await choose(INV.a2!, v2.slots[0].id, cand(2));
    expect(r.status).toBe(409);
    expect((await choose(INV.a2!, v2.slots[1].id, cand(2))).status).toBe(200);
    // Другая компания своё время не делит с A.
    const vb = await (await propose(INV.b1!, [hoursFromNow(4), hoursFromNow(9)], EMP_B)).json();
    expect(vb.slots[0].available).toBe(true);
  });

  it('выбор: сессия живой защиты (defense, aiDefense=false, pending), письма обеим сторонам, уведомления, подстатус у обеих сторон', async () => {
    const v = await (await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(5)])).json();
    const candFeed = await notifications({ userId: 'u-c1', role: 'candidate', candidateId: 'c1', employerProfileId: null });
    expect(candFeed.items[0]!.text).toContain('предлагает время живой защиты');
    const chosen = await (await choose(INV.a1!, v.slots[1].id, cand(1))).json();
    expect(chosen.status).toBe('scheduled');
    expect(chosen.scheduled).toMatchObject({ startsAt: v.slots[1].startsAt, roomOpen: false, roomHref: expect.stringMatching(/^\/defense-room\//) });
    const call = await prisma.callSession.findUniqueOrThrow({ where: { id: chosen.scheduled.callSessionId } });
    expect(call).toMatchObject({ kind: 'defense', aiDefense: false, status: 'pending', projectSubmissionId: 'sub-1', candidateId: 'c1' });
    await new Promise((r) => setTimeout(r, 50)); // письма уходят в фоне
    expect(mailOutbox().filter((m) => m.kind === 'live_defense_scheduled').map((m) => m.to).sort()).toEqual(['c1@example.com', 'hr-a@example.com']);
    expect(mailOutbox().find((m) => m.to === 'c1@example.com')!.text).toContain('МСК');
    const empFeed = await notifications({ userId: 'u-emp-a', role: 'employer', candidateId: null, employerProfileId: 'ep-a' });
    expect(empFeed.items.some((i) => i.text === 'Кандидат выбрал время живой защиты')).toBe(true);
    const emp = await (await employerList(jsonRequest('/x', 'GET', undefined, EMP_A))).json();
    const row = emp.invitations.find((i: { id: string }) => i.id === INV.a1);
    expect(row.liveDefense).toMatchObject({ status: 'scheduled', scheduled: { roomHref: `/employer/calls/${call.id}` } });
    // Повторный выбор — 409, второе предложение поверх назначенной — 409.
    expect((await choose(INV.a1!, v.slots[0].id, cand(1))).status).toBe(409);
    const again = await propose(INV.a1!, [hoursFromNow(7), hoursFromNow(9)]);
    expect((await again.json()).error.code).toBe('live_defense_scheduled');
  });

  it('«ни один не подходит» — работодатель видит комментарий и уведомление, затем предлагает новые', async () => {
    await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(5)]);
    const r = await noneFitRoute(post({ comment: 'Удобно после 19:00 МСК' }, cand(1)), params(INV.a1!));
    expect(r.status).toBe(200);
    const emp = await (await employerList(jsonRequest('/x', 'GET', undefined, EMP_A))).json();
    expect(emp.invitations.find((i: { id: string }) => i.id === INV.a1).liveDefense.noneFit.comment).toBe('Удобно после 19:00 МСК');
    const feed = await notifications({ userId: 'u-emp-a', role: 'employer', candidateId: null, employerProfileId: 'ep-a' });
    expect(feed.items[0]!.text).toBe('Кандидату не подошли слоты защиты');
    expect((await propose(INV.a1!, [hoursFromNow(8), hoursFromNow(10)])).status).toBe(201);
  });

  it('отмена: с причиной, не позднее чем за 1 час; освобождает время компании', async () => {
    const now = new Date();
    const v = await proposeSlots({ companyId: 'co-a', userId: 'u-emp-a' }, INV.a1!, { slots: [hoursFromNow(3), hoursFromNow(5)], durationMin: 30 }, now);
    await chooseSlot('c1', INV.a1!, { slotId: v.slots[0]!.id }, now);
    const startsAt = new Date(v.slots[0]!.startsAt);
    // За 59 минут — поздно.
    await expect(cancelLiveDefense({ role: 'candidate', candidateId: 'c1' }, INV.a1!, 'Заболел', new Date(startsAt.getTime() - 59 * 60_000))).rejects.toMatchObject({ code: 'cancel_too_late' });
    expect((await candidateCancelRoute(post({ reason: '' }, cand(1)), params(INV.a1!))).status).toBe(400);
    expect((await employerCancelRoute(post({ reason: 'Интервьюер заболел' }, EMP_B), params(INV.a1!))).status).toBe(404);
    const r = await candidateCancelRoute(post({ reason: 'Срочная встреча' }, cand(1)), params(INV.a1!));
    expect(r.status).toBe(200);
    expect((await r.json())).toMatchObject({ status: 'cancelled', cancelled: { by: 'candidate', reason: 'Срочная встреча' } });
    // Время освободилось: другой кандидат может его выбрать.
    const v2 = await (await propose(INV.a2!, [v.slots[0]!.startsAt, hoursFromNow(9)])).json();
    expect((await choose(INV.a2!, v2.slots[0].id, cand(2))).status).toBe(200);
  });

  it('комната: открывается за 10 минут до начала — раньше 409 room_not_open (и кандидату, и работодателю)', async () => {
    const now = new Date();
    const v = await proposeSlots({ companyId: 'co-a', userId: 'u-emp-a' }, INV.a1!, { slots: [hoursFromNow(3), hoursFromNow(5)], durationMin: 45 }, now);
    const chosen = await chooseSlot('c1', INV.a1!, { slotId: v.slots[0]!.id }, now);
    const callId = chosen.scheduled!.callSessionId!;
    const startsAt = new Date(chosen.scheduled!.startsAt);
    await expect(assertLiveRoomOpen([callId], new Date(startsAt.getTime() - 11 * 60_000))).rejects.toMatchObject({ code: 'room_not_open', status: 409 });
    await expect(assertLiveRoomOpen([callId], new Date(startsAt.getTime() - 9 * 60_000))).resolves.toBeUndefined();
    await expect(joinCall({ userId: 'u-emp-a', role: 'employer', candidateId: null, employerProfileId: 'ep-a' }, callId)).rejects.toMatchObject({ code: 'room_not_open' });
  });

  it('найм другой компанией закрывает предложение', async () => {
    await propose(INV.b1!, [hoursFromNow(3), hoursFromNow(5)], EMP_B);
    await markInvitationHired('co-a', INV.a1!);
    expect(await prisma.liveDefense.findFirstOrThrow({ where: { invitationId: INV.b1! } })).toMatchObject({ status: 'cancelled', cancelledBy: 'candidate' });
  });

  it('no_show при чтении: назначено в прошлом, никто не пришёл', async () => {
    const v = await (await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(5)])).json();
    await choose(INV.a1!, v.slots[0].id, cand(1));
    const past = new Date(Date.now() - 20 * 60_000);
    await prisma.liveDefense.updateMany({ where: { invitationId: INV.a1! }, data: { startsAt: past, endsAt: new Date(past.getTime() + 45 * 60_000) } });
    const mine = await (await candidateList(jsonRequest('/x', 'GET', undefined, cand(1)))).json();
    expect(mine.invitations.find((i: { id: string }) => i.id === INV.a1).liveDefense).toMatchObject({ status: 'no_show', noShow: ['candidate', 'employer'] });
  });

  it('слоты только при проверенном проекте: без сабмита 409 project_not_submitted, с сабмитом 201', async () => {
    const slots = [hoursFromNow(3), hoursFromNow(5)];
    const no = await propose(INV.a4!, slots);
    expect(no.status).toBe(409);
    expect((await no.json()).error.code).toBe('project_not_submitted');
    expect(await prisma.liveDefense.count({ where: { invitationId: INV.a4! } })).toBe(0);
    // Сабмит есть, но не проверен (идёт проверка) - тоже нельзя.
    await prisma.projectSubmission.create({ data: { id: 'sub-4', projectTaskId: 'task-1', candidateId: 'c4', repoUrl: 'https://github.com/fsp-demo/p4', status: 'running' } });
    expect((await propose(INV.a4!, slots)).status).toBe(409);
    // Флаг для UI обеих сторон.
    const emp = await (await employerList(jsonRequest('/x', 'GET', undefined, EMP_A))).json();
    expect(emp.invitations.find((i: { id: string }) => i.id === INV.a4).projectReady).toBe(false);
    expect(emp.invitations.find((i: { id: string }) => i.id === INV.a1).projectReady).toBe(true);
    const mine = await (await candidateList(jsonRequest('/x', 'GET', undefined, cand(4)))).json();
    expect(mine.invitations[0].projectReady).toBe(false);
    await prisma.projectSubmission.update({ where: { id: 'sub-4' }, data: { status: 'checked' } });
    expect((await propose(INV.a4!, slots)).status).toBe(201);
  });

  it('неявка работодателя снижает индекс доверия компании; неявка кандидата видна только его компании', async () => {
    const before = (await loadCompanyTrusts(['co-a', 'co-b'])).get('co-a')!;
    expect(before.signals.some((x) => x.code === 'no_shows')).toBe(false);
    const v = await (await propose(INV.a1!, [hoursFromNow(3), hoursFromNow(5)])).json();
    await choose(INV.a1!, v.slots[0].id, cand(1));
    const past = new Date(Date.now() - 20 * 60_000);
    await prisma.liveDefense.updateMany({ where: { invitationId: INV.a1! }, data: { startsAt: past, endsAt: new Date(past.getTime() + 45 * 60_000) } });
    const trusts = await loadCompanyTrusts(['co-a', 'co-b']);
    const after = trusts.get('co-a')!;
    expect(after.signals.find((x) => x.code === 'no_shows')).toMatchObject({ earned: -15 });
    expect(after.index).toBe(Math.max(0, before.index - 15));
    expect(trusts.get('co-b')!.signals.some((x) => x.code === 'no_shows')).toBe(false);
    // Компания A видит неявку кандидата в своей карточке приглашения.
    const a = await (await employerList(jsonRequest('/x', 'GET', undefined, EMP_A))).json();
    expect(a.invitations.find((i: { id: string }) => i.id === INV.a1).liveDefense.noShow).toContain('candidate');
    // Компания B по приглашению того же кандидата ничего не видит: ни защиты, ни неявки.
    const b = await (await employerList(jsonRequest('/x', 'GET', undefined, EMP_B))).json();
    expect(b.invitations.find((i: { id: string }) => i.id === INV.b1).liveDefense).toBeNull();
    expect(JSON.stringify(b)).not.toContain('no_show');
  });
});
