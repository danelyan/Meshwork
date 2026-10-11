// Назначение живой защиты через слоты (ADR 0008, «Назначение живой защиты: слоты», п. 1–7).
// Работодатель предлагает 2–5 слотов по принятому приглашению своей компании, кандидат выбирает один
// (с действующим согласием на запись, ADR 0005) или пишет «ни один не подходит». Выбор создаёт или
// привязывает ожидающую сессию защиты (defense-room/pending.ts). Одно время компании не займут два кандидата:
// advisory-lock компании + проверка пересечений в той же транзакции + уникальный bookedKey слота.
import { Prisma, type LiveDefenseActor } from '@prisma/client';

import { formatMsk } from '@/lib/msk';

import { callRecordingConsentText, hasCallConsent, recordCallConsent, CALL_RECORDING_CONSENT_VERSION } from '../call/consent';
import { assertEmployerConsents } from '../consent/service';
import { prisma } from '../db';
import { requestProjectDefense } from '../defense-room/pending';
import { getEnv } from '../env';
import { AppError, errors } from '../errors';
import { deliverable, notifyInBackground, sendMail } from '../mail';
import { liveDefenseMail } from '../mail/templates';
import { canCancel, deriveSubStatus, isRoomOpen, LIVE_SLOT_RULES, overlaps, roomOpensAt, validateProposal, type LiveActor, type LiveDefenseSubStatus } from './rules';

export interface LiveSlotView {
  id: string;
  startsAt: string;
  endsAt: string;
  /** false — время уже занято другим кандидатом этой компании или прошло. */
  available: boolean;
}

export interface LiveDefenseView {
  id: string;
  status: LiveDefenseSubStatus;
  durationMin: number;
  comment: string | null;
  createdAt: string;
  slots: LiveSlotView[];
  noneFit: { at: string; comment: string } | null;
  scheduled: { slotId: string; startsAt: string; endsAt: string; roomOpensAt: string; roomOpen: boolean; callSessionId: string | null; roomHref: string | null } | null;
  cancelled: { at: string; by: LiveActor; reason: string } | null;
  /** Опоздание больше 15 минут: кто не пришёл. */
  noShow: LiveActor[];
  /** Можно ли сейчас отменить (не позднее чем за 1 час). */
  canCancel: boolean;
}

const liveSelect = {
  id: true,
  invitationId: true,
  companyId: true,
  candidateId: true,
  status: true,
  durationMin: true,
  comment: true,
  createdAt: true,
  noneFitAt: true,
  noneFitComment: true,
  chosenSlotId: true,
  startsAt: true,
  endsAt: true,
  callSessionId: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  slots: { orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, endsAt: true, bookedKey: true } },
} satisfies Prisma.LiveDefenseSelect;

type LiveRow = Prisma.LiveDefenseGetPayload<{ select: typeof liveSelect }>;

const bookedKey = (companyId: string, startsAt: Date) => `${companyId}|${startsAt.toISOString()}`;

/** Занятые (назначенные) интервалы компании, кроме одного предложения. */
async function companyBusy(companyId: string, exceptId: string | null, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const rows = await db.liveDefense.findMany({
    where: { companyId, status: 'scheduled', startsAt: { not: null }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { startsAt: true, endsAt: true },
  });
  return rows.map((r) => ({ startsAt: r.startsAt!, endsAt: r.endsAt! }));
}

/** Представления активных предложений по приглашениям (для списков приглашений обеих сторон). */
export async function liveDefenseViews(invitationIds: readonly string[], role: LiveActor, now = new Date()): Promise<Map<string, LiveDefenseView>> {
  const out = new Map<string, LiveDefenseView>();
  if (!invitationIds.length) return out;
  const rows = await prisma.liveDefense.findMany({ where: { activeKey: { in: [...invitationIds] } }, select: liveSelect });
  if (!rows.length) return out;
  const callIds = rows.map((r) => r.callSessionId).filter((id): id is string => !!id);
  const calls = callIds.length
    ? await prisma.callSession.findMany({
        where: { id: { in: callIds } },
        select: { id: true, status: true, startedAt: true, participants: { orderBy: { joinedAt: 'asc' }, select: { joinedAt: true, user: { select: { employerProfile: { select: { companyId: true } } } } } } },
      })
    : [];
  const callById = new Map(calls.map((c) => [c.id, c]));
  const busyByCompany = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const companyId of new Set(rows.filter((r) => r.status === 'slots_proposed').map((r) => r.companyId))) {
    busyByCompany.set(companyId, await companyBusy(companyId, null));
  }
  for (const r of rows) out.set(r.invitationId, toView(r, role, now, callById.get(r.callSessionId ?? ''), busyByCompany.get(r.companyId) ?? []));
  return out;
}

function toView(
  r: LiveRow,
  role: LiveActor,
  now: Date,
  call: { status: 'active' | 'finished' | 'cancelled' | 'pending'; startedAt: Date; participants: { joinedAt: Date; user: { employerProfile: { companyId: string } | null } }[] } | undefined,
  busy: { startsAt: Date; endsAt: Date }[],
): LiveDefenseView {
  const employerJoinedAt = call?.participants.find((p) => p.user.employerProfile?.companyId === r.companyId)?.joinedAt ?? null;
  const derived = deriveSubStatus({ status: r.status, startsAt: r.startsAt, call: call ? { status: call.status, startedAt: call.startedAt } : null, employerJoinedAt }, now);
  const chosen = r.slots.find((s) => s.id === r.chosenSlotId);
  return {
    id: r.id,
    status: derived.status,
    durationMin: r.durationMin,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    slots: r.slots.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      available: r.status === 'slots_proposed' ? s.startsAt > now && !busy.some((b) => overlaps(b, s)) : s.id === r.chosenSlotId,
    })),
    noneFit: r.noneFitAt ? { at: r.noneFitAt.toISOString(), comment: r.noneFitComment ?? '' } : null,
    scheduled:
      r.status === 'scheduled' && r.startsAt && r.endsAt
        ? {
            slotId: chosen?.id ?? '',
            startsAt: r.startsAt.toISOString(),
            endsAt: r.endsAt.toISOString(),
            roomOpensAt: roomOpensAt(r.startsAt).toISOString(),
            roomOpen: isRoomOpen(r.startsAt, now),
            callSessionId: r.callSessionId,
            roomHref: r.callSessionId ? (role === 'employer' ? `/employer/calls/${r.callSessionId}` : `/defense-room/${r.callSessionId}`) : null,
          }
        : null,
    cancelled: r.cancelledAt && r.cancelledBy ? { at: r.cancelledAt.toISOString(), by: r.cancelledBy, reason: r.cancelReason ?? '' } : null,
    noShow: derived.noShow,
    canCancel: (r.status === 'slots_proposed' && role === 'employer') || (derived.status === 'scheduled' && !!r.startsAt && canCancel(r.startsAt, now)),
  };
}

async function viewOf(invitationId: string, role: LiveActor, now: Date): Promise<LiveDefenseView> {
  const v = (await liveDefenseViews([invitationId], role, now)).get(invitationId);
  if (!v) throw errors.notFound('Предложение слотов не найдено');
  return v;
}

async function addEvent(
  db: Prisma.TransactionClient,
  live: { id: string; candidateId: string; companyId: string },
  audience: LiveDefenseActor,
  kind: 'proposed' | 'scheduled' | 'none_fit' | 'cancelled',
  text: string,
  detail: string,
  at: Date,
) {
  await db.liveDefenseEvent.create({ data: { liveDefenseId: live.id, candidateId: live.candidateId, companyId: live.companyId, audience, kind, text, detail, createdAt: at } });
}

// ---------------------------------------------------------------------------
// Работодатель
// ---------------------------------------------------------------------------

export interface ProposeInput {
  slots: string[];
  durationMin: number;
  comment?: string | null;
}

/**
 * Предложить слоты по принятому приглашению своей компании. Чужое — 404, не accepted — 409.
 * Новое предложение заменяет старое; назначенную (ещё не прошедшую) защиту сначала отменяют — 409.
 */
export async function proposeSlots(ctx: { companyId: string; userId: string }, invitationId: string, input: ProposeInput, now = new Date()): Promise<LiveDefenseView> {
  await assertEmployerConsents(ctx.userId);
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, companyId: ctx.companyId }, select: { id: true, status: true, candidateId: true, company: { select: { name: true } } } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  if (inv.status !== 'accepted') throw new AppError('invitation_not_accepted', 'Назначить защиту можно только по принятому приглашению', 409);
  const slots = validateProposal(input, now);
  const comment = input.comment?.trim() || null;
  if (comment && comment.length > LIVE_SLOT_RULES.maxCommentChars) throw new AppError('comment_too_long', `Комментарий - до ${LIVE_SLOT_RULES.maxCommentChars} знаков`, 400);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`live-slot:${ctx.companyId}`}))`;
    const busy = await companyBusy(ctx.companyId, null, tx);
    if (slots.some((s) => busy.some((b) => overlaps(b, s)))) throw new AppError('slot_taken', 'Одно из времён уже занято защитой другого кандидата', 409);
    const prev = await tx.liveDefense.findUnique({ where: { activeKey: invitationId }, select: { id: true, status: true, startsAt: true } });
    if (prev) {
      // Назначенная и ещё не прошедшая защита: перенос — через отмену (п. 6), чтобы кандидат увидел причину.
      if (prev.status === 'scheduled' && prev.startsAt && prev.startsAt.getTime() + LIVE_SLOT_RULES.noShowAfterMs > now.getTime()) {
        throw new AppError('live_defense_scheduled', 'Защита уже назначена - сначала отмените её с причиной', 409);
      }
      await tx.liveDefense.update({ where: { id: prev.id }, data: { activeKey: null, supersededAt: now } });
      await tx.liveDefenseSlot.updateMany({ where: { liveDefenseId: prev.id }, data: { bookedKey: null } });
    }
    const live = await tx.liveDefense.create({
      data: {
        invitationId,
        companyId: ctx.companyId,
        candidateId: inv.candidateId,
        activeKey: invitationId,
        durationMin: input.durationMin,
        comment,
        proposedByUserId: ctx.userId,
        createdAt: now,
        slots: { create: slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })) },
      },
      select: { id: true, candidateId: true, companyId: true },
    });
    await addEvent(tx, live, 'candidate', 'proposed', `«${inv.company?.name ?? 'Компания'}» предлагает время живой защиты`, `${slots.length} слота на выбор · ${input.durationMin} мин`, now);
  });
  return viewOf(invitationId, 'employer', now);
}

// ---------------------------------------------------------------------------
// Кандидат
// ---------------------------------------------------------------------------

async function candidateLive(candidateId: string, invitationId: string) {
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, candidateId }, select: { id: true, status: true, companyId: true, company: { select: { name: true } } } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  const live = await prisma.liveDefense.findUnique({ where: { activeKey: invitationId }, select: liveSelect });
  if (!live) throw errors.notFound('Предложения слотов нет');
  return { inv, live };
}

/** Сабмит проекта для защиты: сданный под потребность этой компании, иначе последний проверенный, иначе последний. */
async function pickSubmission(candidateId: string, companyId: string): Promise<string | null> {
  const subs = await prisma.projectSubmission.findMany({
    where: { candidateId },
    orderBy: { submittedAt: 'desc' },
    take: 20,
    select: { id: true, status: true, projectTask: { select: { vacancy: { select: { companyId: true } } } } },
  });
  return (subs.find((s) => s.projectTask.vacancy.companyId === companyId) ?? subs.find((s) => s.status === 'checked') ?? subs[0])?.id ?? null;
}

/**
 * Выбрать слот. Нужен действующий согласие на запись (`call_recording`, ADR 0005): без него 409
 * `recording_consent_required`; `recordingConsentVersion` в запросе — дать согласие тем же действием.
 * Слот уже занят другим кандидатом компании — 409 `slot_taken`.
 */
export async function chooseSlot(candidateId: string, invitationId: string, input: { slotId: string; recordingConsentVersion?: string }, now = new Date()): Promise<LiveDefenseView> {
  const { inv, live } = await candidateLive(candidateId, invitationId);
  if (inv.status !== 'accepted') throw new AppError('invitation_not_accepted', 'Приглашение больше не активно', 409);
  if (live.status !== 'slots_proposed') throw new AppError('slot_already_chosen', 'Слот уже выбран или предложение отменено', 409);
  const slot = live.slots.find((s) => s.id === input.slotId);
  if (!slot) throw errors.notFound('Слот не найден');
  if (slot.startsAt <= now) throw new AppError('slot_past', 'Это время уже прошло - попросите компанию предложить новые слоты', 409);

  if (!(await hasCallConsent(candidateId))) {
    if (input.recordingConsentVersion) await recordCallConsent(candidateId, input.recordingConsentVersion);
    else {
      throw new AppError('recording_consent_required', 'Живая защита записывается: подтвердите согласие на запись', 409, {
        version: CALL_RECORDING_CONSENT_VERSION,
        paragraphs: callRecordingConsentText(),
      });
    }
  }

  const companyId = live.companyId;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`live-slot:${companyId}`}))`;
      const busy = await companyBusy(companyId, live.id, tx);
      if (busy.some((b) => overlaps(b, slot))) throw new AppError('slot_taken', 'Это время уже занято - выберите другой слот', 409);
      const r = await tx.liveDefense.updateMany({
        where: { id: live.id, activeKey: invitationId, status: 'slots_proposed' },
        data: { status: 'scheduled', chosenSlotId: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt, scheduledAt: now, noneFitAt: null, noneFitComment: null },
      });
      if (r.count === 0) throw new AppError('slot_already_chosen', 'Слот уже выбран или предложение отменено', 409);
      // Уникальный индекс — вторая линия: даже вне блокировки одно время компании не забронировать дважды.
      await tx.liveDefenseSlot.update({ where: { id: slot.id }, data: { bookedKey: bookedKey(companyId, slot.startsAt), bookedAt: now } });
      const when = `${formatMsk(slot.startsAt)}, ${live.durationMin} мин`;
      await addEvent(tx, live, 'employer', 'scheduled', 'Кандидат выбрал время живой защиты', when, now);
      await addEvent(tx, live, 'candidate', 'scheduled', `Живая защита с «${inv.company?.name ?? 'компанией'}» назначена`, when, now);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('slot_taken', 'Это время уже занято - выберите другой слот', 409);
    throw e;
  }

  // Сессия живой защиты (CallSession kind=defense, aiDefense=false) — существующий механизм ожидающей защиты.
  const submissionId = await pickSubmission(candidateId, companyId);
  if (submissionId) {
    const { callSessionId } = await requestProjectDefense(candidateId, submissionId);
    await prisma.liveDefense.update({ where: { id: live.id }, data: { callSessionId } });
  }
  void notifyInBackground('live_defense', () => mailScheduled(live.id));
  return viewOf(invitationId, 'candidate', now);
}

/** «Ни один не подходит» с комментарием: работодатель получает уведомление и предлагает новые слоты. */
export async function rejectSlots(candidateId: string, invitationId: string, comment: string, now = new Date()): Promise<LiveDefenseView> {
  const text = comment.trim();
  if (text.length < LIVE_SLOT_RULES.minReasonChars || text.length > LIVE_SLOT_RULES.maxCommentChars) {
    throw new AppError('comment_invalid', `Напишите, когда вам удобно (от ${LIVE_SLOT_RULES.minReasonChars} до ${LIVE_SLOT_RULES.maxCommentChars} знаков)`, 400);
  }
  const { inv, live } = await candidateLive(candidateId, invitationId);
  if (inv.status !== 'accepted') throw new AppError('invitation_not_accepted', 'Приглашение больше не активно', 409);
  await prisma.$transaction(async (tx) => {
    const r = await tx.liveDefense.updateMany({ where: { id: live.id, activeKey: invitationId, status: 'slots_proposed' }, data: { noneFitAt: now, noneFitComment: text } });
    if (r.count === 0) throw new AppError('slot_already_chosen', 'Слот уже выбран или предложение отменено', 409);
    await addEvent(tx, live, 'employer', 'none_fit', 'Кандидату не подошли слоты защиты', text.slice(0, 120), now);
  });
  return viewOf(invitationId, 'candidate', now);
}

// ---------------------------------------------------------------------------
// Отмена (любая сторона): не позднее чем за 1 час, с причиной
// ---------------------------------------------------------------------------

export async function cancelLiveDefense(
  actor: { role: 'employer'; companyId: string; userId: string } | { role: 'candidate'; candidateId: string },
  invitationId: string,
  reason: string,
  now = new Date(),
): Promise<LiveDefenseView> {
  const text = reason.trim();
  if (text.length < LIVE_SLOT_RULES.minReasonChars || text.length > LIVE_SLOT_RULES.maxReasonChars) {
    throw new AppError('reason_invalid', `Причина отмены - от ${LIVE_SLOT_RULES.minReasonChars} до ${LIVE_SLOT_RULES.maxReasonChars} знаков`, 400);
  }
  if (actor.role === 'employer') await assertEmployerConsents(actor.userId);
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, ...(actor.role === 'employer' ? { companyId: actor.companyId } : { candidateId: actor.candidateId }) },
    select: { id: true, company: { select: { name: true } } },
  });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  const live = await prisma.liveDefense.findUnique({ where: { activeKey: invitationId }, select: { id: true, status: true, startsAt: true, candidateId: true, companyId: true } });
  if (!live) throw errors.notFound('Защита не назначена');
  const proposalOnly = live.status === 'slots_proposed';
  if (proposalOnly && actor.role !== 'employer') throw new AppError('not_scheduled', 'Защита ещё не назначена - можно ответить «ни один не подходит»', 409);
  if (!proposalOnly && live.status !== 'scheduled') throw new AppError('not_scheduled', 'Защита уже отменена', 409);
  if (!proposalOnly && live.startsAt && !canCancel(live.startsAt, now)) throw new AppError('cancel_too_late', 'Отменить можно не позднее чем за 1 час до начала', 409);
  await prisma.$transaction(async (tx) => {
    const r = await tx.liveDefense.updateMany({
      where: { id: live.id, status: live.status },
      data: { status: 'cancelled', cancelledAt: now, cancelledBy: actor.role, cancelReason: text },
    });
    if (r.count === 0) throw errors.conflict('Состояние защиты изменилось - обновите страницу');
    await tx.liveDefenseSlot.updateMany({ where: { liveDefenseId: live.id }, data: { bookedKey: null } });
    const when = live.startsAt ? formatMsk(live.startsAt) : 'предложенные слоты';
    if (actor.role === 'employer') await addEvent(tx, live, 'candidate', 'cancelled', `«${inv.company?.name ?? 'Компания'}» отменила живую защиту`, `${when} · ${text.slice(0, 100)}`, now);
    else await addEvent(tx, live, 'employer', 'cancelled', 'Кандидат отменил живую защиту', `${when} · ${text.slice(0, 100)}`, now);
  });
  return viewOf(invitationId, actor.role, now);
}

/** Найм другой компанией закрывает предложения и назначенные защиты остальных компаний (ADR 0008 п. 6). */
export async function closeLiveDefensesOnHire(companyId: string, invitationId: string, now = new Date()): Promise<void> {
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId }, select: { candidateId: true } });
  if (!inv) return;
  const open = await prisma.liveDefense.findMany({
    where: { candidateId: inv.candidateId, companyId: { not: companyId }, activeKey: { not: null }, status: { in: ['slots_proposed', 'scheduled'] } },
    select: { id: true, candidateId: true, companyId: true },
  });
  for (const live of open) {
    await prisma.$transaction(async (tx) => {
      await tx.liveDefense.update({ where: { id: live.id }, data: { status: 'cancelled', cancelledAt: now, cancelledBy: 'candidate', cancelReason: 'Кандидат принял предложение другой компании' } });
      await tx.liveDefenseSlot.updateMany({ where: { liveDefenseId: live.id }, data: { bookedKey: null } });
      await addEvent(tx, live, 'employer', 'cancelled', 'Живая защита закрыта: кандидат нанят другой компанией', 'Предложение слотов закрыто', now);
    });
  }
}

/**
 * lane invite-cancel: работодатель отозвал приглашение — активное предложение слотов или назначенная защита
 * закрываются (`cancelled`, причина «Приглашение отозвано»), слоты освобождаются. Ожидающая сессия живой защиты
 * (CallSession pending) отменяется, если на неё не ссылается активная защита другой компании (pending.ts: одна
 * ожидающая сессия на сабмит). Вызывается в транзакции отзыва — статус приглашения и защита меняются вместе.
 */
export async function closeLiveDefenseOnWithdraw(tx: Prisma.TransactionClient, invitationId: string, now = new Date()): Promise<void> {
  const live = await tx.liveDefense.findUnique({ where: { activeKey: invitationId }, select: { id: true, status: true, callSessionId: true } });
  if (!live) return;
  if (live.status === 'slots_proposed' || live.status === 'scheduled') {
    await tx.liveDefense.update({ where: { id: live.id }, data: { status: 'cancelled', cancelledAt: now, cancelledBy: 'employer', cancelReason: 'Приглашение отозвано' } });
    await tx.liveDefenseSlot.updateMany({ where: { liveDefenseId: live.id }, data: { bookedKey: null } });
  }
  if (live.callSessionId) {
    const shared = await tx.liveDefense.count({ where: { callSessionId: live.callSessionId, id: { not: live.id }, activeKey: { not: null }, status: { in: ['slots_proposed', 'scheduled'] } } });
    if (shared === 0) await tx.callSession.updateMany({ where: { id: live.callSessionId, status: 'pending' }, data: { status: 'cancelled', finishedAt: now } });
  }
}

// ---------------------------------------------------------------------------
// Комната: открывается за 10 минут до начала (п. 5)
// ---------------------------------------------------------------------------

function roomNotOpen(startsAt: Date): AppError {
  const opens = roomOpensAt(startsAt);
  return new AppError('room_not_open', `Комната откроется ${formatMsk(opens)} - за 10 минут до начала защиты`, 409, { opensAt: opens.toISOString(), startsAt: startsAt.toISOString() });
}

/** Сессия привязана к назначенной живой защите, а до начала больше 10 минут — 409 `room_not_open`. */
export async function assertLiveRoomOpen(callSessionIds: readonly string[], now = new Date()): Promise<void> {
  if (!callSessionIds.length) return;
  const rows = await prisma.liveDefense.findMany({ where: { callSessionId: { in: [...callSessionIds] }, status: 'scheduled', activeKey: { not: null } }, select: { startsAt: true } });
  const blocked = rows.find((r) => r.startsAt && !isRoomOpen(r.startsAt, now));
  if (blocked?.startsAt) throw roomNotOpen(blocked.startsAt);
}

// ---------------------------------------------------------------------------
// Письма (п. 4): обеим сторонам, время по МСК и ссылка на комнату
// ---------------------------------------------------------------------------

async function mailScheduled(liveDefenseId: string): Promise<void> {
  const live = await prisma.liveDefense.findUnique({
    where: { id: liveDefenseId },
    select: {
      startsAt: true,
      durationMin: true,
      callSessionId: true,
      invitation: { select: { candidate: { select: { email: true } }, company: { select: { name: true } }, vacancy: { select: { title: true } }, employerProfile: { select: { user: { select: { email: true } } } } } },
    },
  });
  if (!live?.startsAt) return;
  const base = getEnv().APP_URL;
  const inv = live.invitation;
  const common = { startsAt: live.startsAt, durationMin: live.durationMin, companyName: inv.company?.name ?? 'Компания', vacancyTitle: inv.vacancy?.title ?? null };
  if (deliverable(inv.candidate.email)) {
    await sendMail(liveDefenseMail(inv.candidate.email, { ...common, audience: 'candidate', roomUrl: `${base}${live.callSessionId ? `/defense-room/${live.callSessionId}` : '/invitations'}` }));
  }
  const to = inv.employerProfile?.user.email;
  if (deliverable(to)) {
    await sendMail(liveDefenseMail(to, { ...common, audience: 'employer', roomUrl: `${base}${live.callSessionId ? `/employer/calls/${live.callSessionId}` : '/employer/invitations'}` }));
  }
}
