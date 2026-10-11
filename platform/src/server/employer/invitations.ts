// Приглашения (R-E-05, R-C-11, R-C-16, R-E-07). Статусы: sent → viewed → accepted | declined; accepted → hired (lane hired: работодатель отметил найм);
// sent | viewed | accepted → withdrawn (lane invite-cancel: работодатель отозвал с причиной).
// Контакты работодатель видит только после accepted — решает matching/privacy на сервере.
import type { InvitationStatus, Prisma } from '@prisma/client';
import type { z } from 'zod';

import { assertEmployerConsents, consentRequired, disclosedInvitationIds, revokeDisclosureForInvitation, grantConsent, hasActiveConsent, revokeConsent, userIdForCandidate } from '../consent/service';
import { consentVersion } from '../consent/texts';
import { prisma } from '../db';
import { AppError, errors } from '../errors';
import { deliverable, notifyInBackground, sendMail } from '../mail';
import { invitationAnswerMail, invitationMail, invitationWithdrawnMail } from '../mail/templates';
import { closeLiveDefenseOnWithdraw, closeLiveDefensesOnHire, liveDefenseViews, projectReadyByInvitation, type LiveDefenseView } from '../live-defense/service';
import { loadCatalog } from '../recommend/evidence';
import type { Grade, Specialization } from '../types';

import { notifyAtsStatusChanged } from './ats-webhook';
import { detectRedFlags, invitationSanction, type RedFlag } from './antifraud';
import { countRecentComplaints } from './complaints';
import { loadCompanyTrusts } from './company';
import { loadPool } from './matching';
import { companyInviteContact, toCandidateCard, type CandidateCard } from './privacy';
import type { InvitationInput } from './schemas';
import { isDisclosableStatus } from './invitation-status';
import { DAILY_INVITATION_LIMIT } from './weights';

const OPEN: InvitationStatus[] = ['sent', 'viewed'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** lane lifecycle: пауза после отказа кандидата или отзыва компанией — столько дней компания не может пригласить его снова. */
export const INVITE_COOLDOWN_DAYS = 14;
/** lane lifecycle: причина отзыва при закрытии вакансии; такой отзыв паузу не запускает — это не отказ кандидату лично. */
export const VACANCY_CLOSED_REASON = 'Вакансия закрыта';
/** lane lifecycle: причина закрытия при найме другой компанией (имя нанявшей компании не раскрывается). */
export const HIRED_ELSEWHERE_REASON = 'Кандидат принял предложение другой компании';
/** lane lifecycle: открытые приглашения, которые закрывает найм кандидата другой компанией. */
export const CLOSED_BY_HIRE: InvitationStatus[] = ['sent', 'viewed', 'accepted'];
/** Приглашения, созданные из принятого самоотклика, лимит 20/сутки не расходуют. */
const COUNTS_TO_LIMIT = { sourceApplicationId: null } as const;

/**
 * lane lifecycle: дата, с которой компания снова может пригласить кандидата; null — пауза не действует.
 * Пауза — 14 дней от последнего отказа кандидата (declined, respondedAt) или отзыва компанией (withdrawn, withdrawnAt),
 * кроме отзыва из-за закрытия вакансии. Чистая функция.
 */
export function inviteCooldownUntil(rows: readonly { status: InvitationStatus; respondedAt: Date | null; withdrawnAt: Date | null; withdrawReason: string | null }[], now = new Date()): Date | null {
  let last = 0;
  for (const r of rows) {
    const at = r.status === 'declined' ? r.respondedAt : r.status === 'withdrawn' && r.withdrawReason !== VACANCY_CLOSED_REASON ? r.withdrawnAt : null;
    if (at && at.getTime() > last) last = at.getTime();
  }
  if (!last) return null;
  const next = new Date(last + INVITE_COOLDOWN_DAYS * DAY_MS);
  return next > now ? next : null;
}

export interface EmployerInvitationView {
  id: string;
  status: InvitationStatus;
  /** Вилка предложения, ₽ в месяц (ТЗ 2.2). */
  salaryFrom: number;
  salaryTo: number;
  message: string | null;
  createdAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  /** lane hired: когда отмечен найм (status = hired). */
  hiredAt?: string | null;
  /** lane invite-cancel: отзыв работодателем (status = withdrawn) — когда и почему. */
  withdrawn?: { at: string; reason: string } | null;
  vacancy: { id: string; title: string } | null;
  candidate: CandidateCard;
  /** lane live-slots (ADR 0008): активное предложение слотов живой защиты и его подстатус; null — не назначалась. */
  liveDefense?: LiveDefenseView | null;
  /** lane defense-rules (ADR 0008): у кандидата есть проверенный проект - только тогда можно предлагать слоты живой защиты. */
  projectReady?: boolean;
}

export interface CandidateInvitationView {
  id: string;
  status: InvitationStatus;
  /** Вилка предложения, ₽ в месяц (ТЗ 2.2): видна до принятия. */
  salaryFrom: number;
  salaryTo: number;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  /** lane hired: когда компания отметила найм (status = hired) — финальный этап пути. */
  hiredAt?: string | null;
  /** lane invite-cancel: компания отозвала приглашение (status = withdrawn) — когда и причина. */
  withdrawn?: { at: string; reason: string } | null;
  /**
   * Компания и способ связи — до принятия (ТЗ 2.2: «кандидат видит условия до начала общения»).
   * contact: Company.contact, иначе почта отправителя; null — не указан (интерфейс пишет NO_COMPANY_CONTACT).
   */
  company: { name: string; description: string | null; contact: string | null; trust?: { index: number; band: 'low' | 'medium' | 'high'; concept: true } | null };
  /** Антифрод (R-X-01): красные флаги текста и вилки; пустой — ничего не найдено. Интерфейс пишет «Проверьте: …». */
  redFlags?: Pick<RedFlag, 'code' | 'severity' | 'candidateNote'>[];
  /** lane complaints: жалоба кандидата на это приглашение; null — не подавалась. */
  complaint?: { reason: string; createdAt: string } | null;
  /** Принято и раскрытие имени и контактов действует (Г5, ADR 0005); false после отзыва — компания видит псевдоним. */
  disclosed?: boolean;
  /** lane live-slots (ADR 0008): слоты живой защиты и подстатус; null — компания ещё не предлагала. */
  liveDefense?: LiveDefenseView | null;
  /** lane defense-rules: у кандидата есть проверенный проект (иначе живую защиту назначить нельзя - сдайте его в «Проектах»). */
  projectReady?: boolean;
  vacancy: {
    title: string;
    specialization: Specialization;
    grade: Grade;
    salaryFrom: number;
    salaryTo: number;
    teamDescription: string | null;
    stack: string[];
  } | null;
}

export async function invitationsSentToday(companyId: string, now = new Date()): Promise<number> {
  return prisma.invitation.count({ where: { companyId, ...COUNTS_TO_LIMIT, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
}

/**
 * Способ связи, который увидит кандидат в приглашении от этого представителя компании (E05): Company.contact,
 * иначе почта его аккаунта, если она не служебная; null — отправлять нельзя (company_contact_required).
 */
export async function companyInviteContactFor(employerProfileId: string): Promise<string | null> {
  const p = await prisma.employerProfile.findUnique({
    where: { id: employerProfileId },
    select: { user: { select: { email: true } }, company: { select: { contact: true } } },
  });
  if (!p) throw errors.forbidden('Профиль работодателя не найден');
  return companyInviteContact({ contact: p.company.contact, senderEmail: p.user.email });
}

/** 422 company_contact_required: у компании нет контакта, а почта отправителя служебная — кандидату некуда ответить. */
export function companyContactRequired(): AppError {
  return new AppError(
    'company_contact_required',
    'Укажите способ связи компании (почта или Telegram) на странице «Компания»: кандидат видит его в приглашении ещё до ответа',
    422,
    { companyUrl: '/employer/company' },
  );
}

/**
 * Отправить приглашение. 404 — кандидата нет или он скрыт настройкой приватности;
 * 404 — чужая или архивная потребность; 409 — уже есть открытое приглашение этой
 * компании; 422 company_contact_required — ни контакта компании, ни пригодной почты отправителя (E05: кандидат должен
 * видеть способ связи до ответа); 429 — лимит за сутки; 403 company_blocked — отправка закрыта из-за жалоб.
 * Лимит, жалобы и дубль проверяются под advisory-lock компании, чтобы параллельные
 * запросы не обошли счётчик. Жалобы кандидатов за 30 дней снижают лимит (antifraud.invitationSanction).
 */
export async function createInvitation(
  ctx: { companyId: string; employerProfileId: string },
  input: z.infer<typeof InvitationInput>,
  limit = DAILY_INVITATION_LIMIT,
): Promise<{ id: string; status: InvitationStatus }> {
  // Приглашения — только после оферты и обязательства по данным кандидатов (ADR 0005).
  const sender = await prisma.employerProfile.findUnique({
    where: { id: ctx.employerProfileId },
    select: { userId: true, user: { select: { email: true } }, company: { select: { contact: true } } },
  });
  if (!sender) throw errors.forbidden('Профиль работодателя не найден');
  await assertEmployerConsents(sender.userId);
  const cand = await prisma.candidate.findFirst({ where: { id: input.candidateId, hiddenFromEmployers: false }, select: { id: true } });
  if (!cand) throw errors.notFound('Кандидат не найден');
  if (input.vacancyId) {
    const v = await prisma.vacancy.findFirst({ where: { id: input.vacancyId, companyId: ctx.companyId, archivedAt: null }, select: { id: true } });
    if (!v) throw errors.notFound('Потребность не найдена');
  }
  // E05: кандидат видит способ связи до ответа — без контакта компании и пригодной почты отправителя не отправляем.
  if (!companyInviteContact({ contact: sender.company.contact, senderEmail: sender.user.email })) throw companyContactRequired();
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${ctx.companyId}`}))`;
    const open = await tx.invitation.findFirst({
      where: { companyId: ctx.companyId, candidateId: input.candidateId, status: { in: OPEN } },
      select: { id: true },
    });
    if (open) throw errors.conflict('Кандидат ещё не ответил на прошлое приглашение компании');
    // lane lifecycle: пауза 14 дней после отказа кандидата или отзыва компанией — под тем же lock, что и дубль.
    const past = await tx.invitation.findMany({
      where: { companyId: ctx.companyId, candidateId: input.candidateId, status: { in: ['declined', 'withdrawn'] }, OR: [{ respondedAt: { gt: new Date(Date.now() - INVITE_COOLDOWN_DAYS * DAY_MS) } }, { withdrawnAt: { gt: new Date(Date.now() - INVITE_COOLDOWN_DAYS * DAY_MS) } }] },
      select: { status: true, respondedAt: true, withdrawnAt: true, withdrawReason: true },
    });
    const nextAt = inviteCooldownUntil(past);
    if (nextAt) {
      throw new AppError(
        'invite_cooldown',
        `Пригласить этого кандидата снова можно с ${nextAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} МСК: после отказа или отзыва действует пауза ${INVITE_COOLDOWN_DAYS} дней`,
        409,
        { nextAt: nextAt.toISOString() },
      );
    }
    // lane complaints: санкция читается тем же tx под тем же lock — решение и вставка в одной транзакции.
    const sanction = invitationSanction(await countRecentComplaints(tx, ctx.companyId), limit);
    if (sanction.level === 'blocked') {
      throw new AppError(
        'company_blocked',
        `Отправка приглашений приостановлена: ${sanction.complaints} жалоб кандидатов за 30 дней. Проверьте тексты и вилки приглашений.`,
        403,
        { complaints: sanction.complaints },
      );
    }
    const effective = sanction.limit;
    const sent = await tx.invitation.count({ where: { companyId: ctx.companyId, ...COUNTS_TO_LIMIT, createdAt: { gt: new Date(Date.now() - DAY_MS) } } });
    if (sent >= effective) {
      const why = sanction.level === 'reduced' ? ` (лимит снижен из-за ${sanction.complaints} жалоб кандидатов за 30 дней)` : '';
      throw new AppError('rate_limited', `Лимит: не больше ${effective} приглашений от компании за сутки${why}`, 429, { limit: effective, sanction: sanction.level });
    }
    return tx.invitation.create({
      data: {
        companyId: ctx.companyId,
        employerProfileId: ctx.employerProfileId,
        candidateId: input.candidateId,
        vacancyId: input.vacancyId ?? null,
        message: input.message,
        salaryFrom: input.salaryFrom,
        salaryTo: input.salaryTo,
      },
      select: { id: true, status: true },
    });
  });
  // lane: email-auth — письмо кандидату, не задерживая ответ работодателю.
  void notifyInBackground('invitation', () => notifyCandidateInvited(created.id));
  void notifyInBackground('ats', () => notifyAtsStatusChanged(created.id));
  return created;
}

/** Письмо кандидату о новом приглашении (компания, позиция, зарплата). Служебный адрес — пропуск. */
export async function notifyCandidateInvited(invitationId: string): Promise<void> {
  const inv = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: {
      salaryFrom: true,
      salaryTo: true,
      candidate: { select: { email: true } },
      company: { select: { name: true } },
      vacancy: { select: { title: true, company: { select: { name: true } } } },
    },
  });
  if (!inv || !deliverable(inv.candidate.email)) return;
  const companyName = inv.company?.name ?? inv.vacancy?.company.name ?? 'Компания';
  await sendMail(invitationMail(inv.candidate.email, { companyName, vacancyTitle: inv.vacancy?.title ?? null, salaryFrom: inv.salaryFrom, salaryTo: inv.salaryTo }));
}

/** Письмо работодателю-отправителю об ответе кандидата. Нет отправителя или почты — пропуск. */
export async function notifyEmployerAnswered(invitationId: string, accepted: boolean): Promise<void> {
  const inv = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { vacancy: { select: { title: true } }, employerProfile: { select: { user: { select: { email: true } } } } },
  });
  const to = inv?.employerProfile?.user.email;
  if (!inv || !deliverable(to)) return;
  await sendMail(invitationAnswerMail(to, { accepted, vacancyTitle: inv.vacancy?.title ?? null }));
}

/** Приглашения компании с карточкой кандидата: контакты — только у принятых. */
export async function listCompanyInvitations(companyId: string): Promise<EmployerInvitationView[]> {
  const rows = await prisma.invitation.findMany({
    where: { companyId },
    select: {
      id: true,
      status: true,
      salaryFrom: true,
      salaryTo: true,
      message: true,
      createdAt: true,
      viewedAt: true,
      respondedAt: true,
      hiredAt: true,
      withdrawnAt: true,
      withdrawReason: true,
      candidateId: true,
      vacancy: { select: { id: true, title: true } },
      candidate: {
        select: {
          id: true,
          name: true,
          email: true,
          contact: true,
          specialization: true,
          fspState: true,
          categories: { orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }], take: 1, select: { specialization: true, grade: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  if (rows.length === 0) return [];
  const catalog = await loadCatalog();
  const pool = new Map((await loadPool(catalog)).map((p) => [p.evidence.id, p.claimsPublic]));
  // Имя и контакты — только по принятому приглашению с действующим раскрытием (Г5, ADR 0005): отзыв возвращает псевдоним.
  const disclosed = await disclosedInvitationIds(rows.filter((r) => isDisclosableStatus(r.status)).map((r) => r.id));
  const accepted = new Set(rows.filter((r) => disclosed.has(r.id)).map((r) => r.candidateId));
  const live = await liveDefenseViews(rows.map((r) => r.id), 'employer');
  const ready = await projectReadyByInvitation(rows.filter((r) => r.status === 'accepted').map((r) => ({ id: r.id, candidateId: r.candidateId, companyId })));
  return rows.map((r) => ({
    liveDefense: live.get(r.id) ?? null,
    projectReady: ready.get(r.id) ?? false,
    id: r.id,
    status: r.status,
    salaryFrom: r.salaryFrom,
    salaryTo: r.salaryTo,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    viewedAt: r.viewedAt?.toISOString() ?? null,
    respondedAt: r.respondedAt?.toISOString() ?? null,
    hiredAt: r.hiredAt?.toISOString() ?? null,
    withdrawn: withdrawnView(r),
    vacancy: r.vacancy,
    candidate: toCandidateCard(
      {
        id: r.candidate.id,
        name: r.candidate.name,
        email: r.candidate.email,
        contact: r.candidate.contact,
        specialization: r.candidate.specialization,
        fspState: r.candidate.fspState,
        category: r.candidate.categories[0] ?? null,
        claims: pool.get(r.candidate.id) ?? [],
      },
      accepted.has(r.candidateId),
    ),
  }));
}

/**
 * Входящие приглашения кандидата (R-C-11, R-C-16: только свои). `markViewed` —
 * открытие страницы переводит sent → viewed.
 */
export async function listCandidateInvitations(candidateId: string, markViewed = false): Promise<CandidateInvitationView[]> {
  if (markViewed) {
    await prisma.invitation.updateMany({ where: { candidateId, status: 'sent' }, data: { status: 'viewed', viewedAt: new Date() } });
  }
  const rows = await prisma.invitation.findMany({
    where: { candidateId },
    select: {
      id: true,
      status: true,
      salaryFrom: true,
      salaryTo: true,
      message: true,
      createdAt: true,
      respondedAt: true,
      hiredAt: true,
      withdrawnAt: true,
      withdrawReason: true,
      complaint: { select: { reason: true, createdAt: true } },
      company: { select: { id: true, name: true, description: true, contact: true } },
      employerProfile: { select: { user: { select: { email: true } } } },
      vacancy: {
        select: {
          title: true,
          specialization: true,
          grade: true,
          salaryFrom: true,
          salaryTo: true,
          teamDescription: true,
          stack: true,
          company: { select: { id: true, name: true, description: true, contact: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const trusts = await loadCompanyTrusts(rows.map((r) => (r.company ?? r.vacancy?.company)?.id).filter((id): id is string => !!id));
  const disclosed = await disclosedInvitationIds(rows.filter((r) => isDisclosableStatus(r.status)).map((r) => r.id));
  const live = await liveDefenseViews(rows.map((r) => r.id), 'candidate');
  const ready = await projectReadyByInvitation(rows.filter((r) => r.status === 'accepted').map((r) => ({ id: r.id, candidateId, companyId: (r.company ?? r.vacancy?.company)?.id ?? null })));
  return rows.map((r) => {
    const co = r.company ?? r.vacancy?.company ?? { id: null, name: 'Компания', description: null, contact: null };
    const senderEmail = r.employerProfile?.user.email;
    const t = co.id ? trusts.get(co.id) : undefined;
    const company = {
      name: co.name,
      description: co.description,
      contact: companyInviteContact({ contact: co.contact, senderEmail }),
      trust: t ? { index: t.index, band: t.band, concept: t.concept } : null,
    };
    const v = r.vacancy;
    const vacancy = v
      ? { title: v.title, specialization: v.specialization, grade: v.grade, salaryFrom: v.salaryFrom, salaryTo: v.salaryTo, teamDescription: v.teamDescription, stack: v.stack }
      : null;
    return {
      id: r.id,
      status: r.status,
      salaryFrom: r.salaryFrom,
      salaryTo: r.salaryTo,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      hiredAt: r.hiredAt?.toISOString() ?? null,
      withdrawn: withdrawnView(r),
      company,
      redFlags: detectRedFlags({
        texts: [r.message, r.vacancy?.title, r.vacancy?.teamDescription],
        salaryFrom: r.salaryFrom,
        salaryTo: r.salaryTo,
      }).map(({ code, severity, candidateNote }) => ({ code, severity, candidateNote })),
      disclosed: disclosed.has(r.id),
      complaint: r.complaint ? { reason: r.complaint.reason, createdAt: r.complaint.createdAt.toISOString() } : null,
      liveDefense: live.get(r.id) ?? null,
      projectReady: ready.get(r.id) ?? false,
      vacancy,
    };
  });
}

/**
 * Ответ кандидата. Чужое — 404; уже отвеченное — 409. Условный update — без гонки двойного ответа.
 * accept требует отдельного подтверждения раскрытия имени и контактов этому работодателю (Г5, ADR 0005):
 * без `disclosureVersion` — 409 consent_required, приглашение остаётся открытым. Статус и согласие — одной транзакцией.
 */
export async function respondInvitation(candidateId: string, invitationId: string, action: 'accept' | 'decline', disclosureVersion?: string) {
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, candidateId }, select: { id: true } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  const status: InvitationStatus = action === 'accept' ? 'accepted' : 'declined';
  let userId: string | null = null;
  if (status === 'accepted') {
    if (!disclosureVersion) throw consentRequired('identity_disclosure', 'Чтобы принять приглашение, подтвердите раскрытие имени и контактов этому работодателю.');
    if (disclosureVersion !== consentVersion('identity_disclosure')) throw errors.conflict('Текст согласия обновился - обновите страницу');
    userId = await userIdForCandidate(candidateId);
    if (!userId) throw errors.forbidden('Принять приглашение может аккаунт кандидата - войдите заново');
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const r = await tx.invitation.updateMany({
      where: { id: invitationId, candidateId, status: { in: OPEN } },
      data: { status, respondedAt: now },
    });
    if (r.count === 0) throw errors.conflict('На приглашение уже ответили');
    if (userId) {
      await tx.consent.create({ data: { userId, kind: 'identity_disclosure', version: disclosureVersion!, acceptedAt: now, context: { invitationId } } });
    }
  });
  void notifyInBackground('invitation_answer', () => notifyEmployerAnswered(invitationId, status === 'accepted'));
  void notifyInBackground('ats', () => notifyAtsStatusChanged(invitationId));
  return { id: invitationId, status };
}

/**
 * lane hired: работодатель отмечает найм по своему принятому приглашению (accepted → hired).
 * Чужое или несуществующее — 404; уже hired — идемпотентно возвращает текущее состояние; иной статус — 409.
 * Условный update — без гонки с отзывом/повторной отметкой.
 */
export async function markInvitationHired(companyId: string, invitationId: string): Promise<{ id: string; status: InvitationStatus; hiredAt: string }> {
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, companyId }, select: { status: true, hiredAt: true, candidateId: true } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  if (inv.status === 'hired') return { id: invitationId, status: 'hired', hiredAt: (inv.hiredAt ?? new Date()).toISOString() };
  if (inv.status !== 'accepted') throw errors.conflict('Отметить найм можно только по принятому приглашению');
  const now = new Date();
  // lane lifecycle: найм, закрытие открытых приглашений и самооткликов других компаний — одной транзакцией под lock
  // кандидата: две компании не наймут одного кандидата одновременно (вторая получит 409 — её приглашение уже closed_hired).
  const closed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hire:${inv.candidateId}`}))`;
    const r = await tx.invitation.updateMany({ where: { id: invitationId, companyId, status: 'accepted' }, data: { status: 'hired', hiredAt: now } });
    if (r.count === 0) return null;
    return closeOthersOnHire(tx, companyId, inv.candidateId, now);
  });
  if (!closed) {
    const again = await prisma.invitation.findFirst({ where: { id: invitationId, companyId }, select: { status: true, hiredAt: true } });
    if (again?.status === 'hired') return { id: invitationId, status: 'hired', hiredAt: (again.hiredAt ?? now).toISOString() };
    throw errors.conflict('Отметить найм можно только по принятому приглашению');
  }
  // Живые защиты других компаний закрывает live-defense (своей транзакцией): их приглашения уже closed_hired,
  // новые слоты по ним предложить нельзя (live-defense требует accepted), так что окна для гонки нет.
  await closeLiveDefensesOnHire(companyId, invitationId, now);
  for (const id of [invitationId, ...closed.invitationIds]) void notifyInBackground('ats', () => notifyAtsStatusChanged(id));
  return { id: invitationId, status: 'hired', hiredAt: now.toISOString() };
}

/**
 * lane lifecycle: кандидат нанят компанией `companyId` — его открытые приглашения других компаний (sent/viewed/accepted)
 * становятся closed_hired (closedAt), открытые самоотклики к другим компаниям (sent/viewed) — closed с причиной.
 * Раскрытие по закрытым приглашениям прекращается (как при отзыве). Компании B видят уведомление без имени A.
 */
async function closeOthersOnHire(tx: Prisma.TransactionClient, companyId: string, candidateId: string, now: Date): Promise<{ invitationIds: string[]; applicationIds: string[] }> {
  const invs = await tx.invitation.findMany({
    where: { candidateId, status: { in: CLOSED_BY_HIRE }, NOT: { companyId } },
    select: { id: true },
  });
  const invitationIds = invs.map((i) => i.id);
  if (invitationIds.length) {
    await tx.invitation.updateMany({ where: { id: { in: invitationIds }, status: { in: CLOSED_BY_HIRE } }, data: { status: 'closed_hired', closedAt: now } });
    for (const id of invitationIds) await revokeDisclosureForInvitation(tx, candidateId, id, now);
  }
  const apps = await tx.application.findMany({
    where: { candidateId, status: { in: ['sent', 'viewed'] }, vacancy: { companyId: { not: companyId } } },
    select: { id: true },
  });
  const applicationIds = apps.map((a) => a.id);
  if (applicationIds.length) {
    await tx.application.updateMany({ where: { id: { in: applicationIds }, status: { in: ['sent', 'viewed'] } }, data: { status: 'closed', closedAt: now, closeReason: HIRED_ELSEWHERE_REASON } });
  }
  return { invitationIds, applicationIds };
}

/**
 * lane lifecycle: вакансия закрыта (архив) — открытые приглашения на неё (sent/viewed) отзываются через withdrawInvitation
 * с причиной «Вакансия закрыта» (пауза 14 дней от такого отзыва не действует), accepted не трогаются (контакт уже есть);
 * открытые самоотклики (sent/viewed) закрываются с той же причиной. Гонка с ответом кандидата: отзыв уже принятого
 * в этот момент приглашения — тоже отзыв (withdrawInvitation допускает accepted), поэтому выбираем только sent/viewed
 * и пропускаем те, что за это время ушли в финальный статус (409).
 */
export async function closeVacancyPipelines(
  ctx: { companyId: string; userId: string },
  vacancyId: string,
  now = new Date(),
): Promise<{ withdrawnInvitations: number; acceptedInvitations: number; closedApplications: number }> {
  const open = await prisma.invitation.findMany({ where: { vacancyId, companyId: ctx.companyId, status: { in: OPEN } }, select: { id: true } });
  let withdrawnInvitations = 0;
  for (const { id } of open) {
    try {
      await withdrawInvitation(ctx, id, VACANCY_CLOSED_REASON, now, OPEN);
      withdrawnInvitations++;
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'invitation_not_withdrawable')) throw err;
    }
  }
  const acceptedInvitations = await prisma.invitation.count({ where: { vacancyId, companyId: ctx.companyId, status: 'accepted' } });
  const r = await prisma.application.updateMany({
    where: { vacancyId, vacancy: { companyId: ctx.companyId }, status: { in: ['sent', 'viewed'] } },
    data: { status: 'closed', closedAt: now, closeReason: VACANCY_CLOSED_REASON },
  });
  return { withdrawnInvitations, acceptedInvitations, closedApplications: r.count };
}

const withdrawnView = (r: { withdrawnAt: Date | null; withdrawReason: string | null }) =>
  r.withdrawnAt ? { at: r.withdrawnAt.toISOString(), reason: r.withdrawReason ?? '' } : null;

/** Отозвать можно до найма и до отказа кандидата (lane invite-cancel). */
export const WITHDRAWABLE: InvitationStatus[] = ['sent', 'viewed', 'accepted'];
export const WITHDRAW_REASON = { minChars: 3, maxChars: 300 } as const;

/**
 * lane invite-cancel: работодатель отзывает приглашение своей компании с причиной (sent | viewed | accepted → withdrawn).
 * Чужое — 404; hired, declined, уже отозванное — 409 `invitation_not_withdrawable`. Одной транзакцией: статус, закрытие
 * слотов живой защиты и ожидающей сессии (live-defense), отзыв раскрытия по этому приглашению (как отзыв кандидатом).
 * Лимит приглашений в сутки считается по createdAt — отзыв его не возвращает. Кандидату — уведомление в ленте
 * (notifications.ts по withdrawnAt) и письмо.
 */
export async function withdrawInvitation(
  ctx: { companyId: string; userId: string },
  invitationId: string,
  rawReason: string,
  now = new Date(),
  /** lane lifecycle: из каких статусов отзывать (архив вакансии — только sent/viewed, принятое не трогает). */
  from: readonly InvitationStatus[] = WITHDRAWABLE,
): Promise<{ id: string; status: InvitationStatus; withdrawn: { at: string; reason: string } }> {
  const reason = rawReason.trim();
  if (reason.length < WITHDRAW_REASON.minChars || reason.length > WITHDRAW_REASON.maxChars) {
    throw new AppError('reason_invalid', `Причина отзыва - от ${WITHDRAW_REASON.minChars} до ${WITHDRAW_REASON.maxChars} знаков`, 400);
  }
  await assertEmployerConsents(ctx.userId);
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, companyId: ctx.companyId }, select: { status: true, candidateId: true } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  const notWithdrawable = () => new AppError('invitation_not_withdrawable', 'Отозвать можно только приглашение без ответа или принятое - не после найма и не после отказа', 409);
  if (!from.includes(inv.status)) throw notWithdrawable();
  await prisma.$transaction(async (tx) => {
    const r = await tx.invitation.updateMany({
      where: { id: invitationId, companyId: ctx.companyId, status: { in: [...from] } },
      data: { status: 'withdrawn', withdrawnAt: now, withdrawReason: reason },
    });
    if (r.count === 0) throw notWithdrawable();
    await closeLiveDefenseOnWithdraw(tx, invitationId, now);
    await revokeDisclosureForInvitation(tx, inv.candidateId, invitationId, now);
  });
  void notifyInBackground('invitation_withdrawn', () => notifyCandidateWithdrawn(invitationId));
  void notifyInBackground('ats', () => notifyAtsStatusChanged(invitationId));
  return { id: invitationId, status: 'withdrawn', withdrawn: { at: now.toISOString(), reason } };
}

/** Письмо кандидату об отзыве приглашения. Служебный адрес — пропуск. */
export async function notifyCandidateWithdrawn(invitationId: string): Promise<void> {
  const inv = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { withdrawReason: true, candidate: { select: { email: true } }, company: { select: { name: true } }, vacancy: { select: { title: true } } },
  });
  if (!inv || !deliverable(inv.candidate.email)) return;
  await sendMail(invitationWithdrawnMail(inv.candidate.email, { companyName: inv.company?.name ?? 'Компания', vacancyTitle: inv.vacancy?.title ?? null, reason: inv.withdrawReason ?? '' }));
}

export async function getPrivacy(candidateId: string): Promise<{ hiddenFromEmployers: boolean }> {
  const c = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { hiddenFromEmployers: true } });
  if (!c) throw errors.notFound('Кандидат не найден');
  return c;
}

/** Способ связи кандидата (Q-35): работодатель увидит его только после accepted. */
export async function getCandidateContact(candidateId: string): Promise<{ contact: string | null }> {
  const c = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { contact: true } });
  if (!c) throw errors.notFound('Кандидат не найден');
  return c;
}

/** contact уже нормализован ContactSchema; null — убрать (останется почта аккаунта, если она не служебная). */
export async function setCandidateContact(candidateId: string, contact: string | null): Promise<{ contact: string | null }> {
  const r = await prisma.candidate.updateMany({ where: { id: candidateId }, data: { contact } });
  if (r.count === 0) throw errors.notFound('Кандидат не найден');
  return { contact };
}

/** Настройка приватности (R-C-13): скрыть себя из подборок и поиска работодателей. */
export async function setPrivacy(candidateId: string, hiddenFromEmployers: boolean) {
  // Показ работодателям — согласие Г4 (ADR 0005): переключатель даёт или отзывает его. Профиль без аккаунта
  // (демо-пул сида) согласий не хранит — у него меняется только флаг.
  const userId = await userIdForCandidate(candidateId);
  if (userId && !hiddenFromEmployers) await grantConsent(userId, { kind: 'employer_visibility', version: consentVersion('employer_visibility') });
  if (userId && hiddenFromEmployers && (await hasActiveConsent(userId, 'employer_visibility'))) await revokeConsent(userId, 'employer_visibility');
  const r = await prisma.candidate.updateMany({ where: { id: candidateId }, data: { hiddenFromEmployers } });
  if (r.count === 0) throw errors.notFound('Кандидат не найден');
  return { hiddenFromEmployers };
}
