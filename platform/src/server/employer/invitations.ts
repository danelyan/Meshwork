// Приглашения (R-E-05, R-C-11, R-C-16, R-E-07). Статусы: sent → viewed → accepted | declined; accepted → hired (lane hired: работодатель отметил найм).
// Контакты работодатель видит только после accepted — решает matching/privacy на сервере.
import type { InvitationStatus } from '@prisma/client';
import type { z } from 'zod';

import { assertEmployerConsents, consentRequired, disclosedInvitationIds, grantConsent, hasActiveConsent, revokeConsent, userIdForCandidate } from '../consent/service';
import { consentVersion } from '../consent/texts';
import { prisma } from '../db';
import { AppError, errors } from '../errors';
import { deliverable, notifyInBackground, sendMail } from '../mail';
import { invitationAnswerMail, invitationMail } from '../mail/templates';
import { closeLiveDefensesOnHire, liveDefenseViews, type LiveDefenseView } from '../live-defense/service';
import { loadCatalog } from '../recommend/evidence';
import type { Grade, Specialization } from '../types';

import { notifyAtsStatusChanged } from './ats-webhook';
import { detectRedFlags, type RedFlag } from './antifraud';
import { loadCompanyTrusts } from './company';
import { loadPool } from './matching';
import { contactEmail, toCandidateCard, type CandidateCard } from './privacy';
import type { InvitationInput } from './schemas';
import { isDisclosableStatus } from './invitation-status';
import { DAILY_INVITATION_LIMIT } from './weights';

const OPEN: InvitationStatus[] = ['sent', 'viewed'];
const DAY_MS = 24 * 60 * 60 * 1000;

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
  vacancy: { id: string; title: string } | null;
  candidate: CandidateCard;
  /** lane live-slots (ADR 0008): активное предложение слотов живой защиты и его подстатус; null — не назначалась. */
  liveDefense?: LiveDefenseView | null;
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
  /**
   * Компания и способ связи — до принятия (ТЗ 2.2: «кандидат видит условия до начала общения»).
   * contact: Company.contact, иначе почта отправителя; null — не указан (интерфейс пишет NO_COMPANY_CONTACT).
   */
  company: { name: string; description: string | null; contact: string | null; trust?: { index: number; band: 'low' | 'medium' | 'high'; concept: true } | null };
  /** Антифрод (R-X-01): красные флаги текста и вилки; пустой — ничего не найдено. Интерфейс пишет «Проверьте: …». */
  redFlags?: Pick<RedFlag, 'code' | 'severity' | 'candidateNote'>[];
  /** Принято и раскрытие имени и контактов действует (Г5, ADR 0005); false после отзыва — компания видит псевдоним. */
  disclosed?: boolean;
  /** lane live-slots (ADR 0008): слоты живой защиты и подстатус; null — компания ещё не предлагала. */
  liveDefense?: LiveDefenseView | null;
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
  return prisma.invitation.count({ where: { companyId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
}

/**
 * Отправить приглашение. 404 — кандидата нет или он скрыт настройкой приватности;
 * 404 — чужая или архивная потребность; 409 — уже есть открытое приглашение этой
 * компании; 429 — лимит за сутки. Лимит и дубль проверяются под advisory-lock
 * компании, чтобы параллельные запросы не обошли счётчик.
 */
export async function createInvitation(
  ctx: { companyId: string; employerProfileId: string },
  input: z.infer<typeof InvitationInput>,
  limit = DAILY_INVITATION_LIMIT,
): Promise<{ id: string; status: InvitationStatus }> {
  // Приглашения — только после оферты и обязательства по данным кандидатов (ADR 0005).
  const sender = await prisma.employerProfile.findUnique({ where: { id: ctx.employerProfileId }, select: { userId: true } });
  if (!sender) throw errors.forbidden('Профиль работодателя не найден');
  await assertEmployerConsents(sender.userId);
  const cand = await prisma.candidate.findFirst({ where: { id: input.candidateId, hiddenFromEmployers: false }, select: { id: true } });
  if (!cand) throw errors.notFound('Кандидат не найден');
  if (input.vacancyId) {
    const v = await prisma.vacancy.findFirst({ where: { id: input.vacancyId, companyId: ctx.companyId, archivedAt: null }, select: { id: true } });
    if (!v) throw errors.notFound('Потребность не найдена');
  }
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${ctx.companyId}`}))`;
    const open = await tx.invitation.findFirst({
      where: { companyId: ctx.companyId, candidateId: input.candidateId, status: { in: OPEN } },
      select: { id: true },
    });
    if (open) throw errors.conflict('Кандидат ещё не ответил на прошлое приглашение компании');
    const sent = await tx.invitation.count({ where: { companyId: ctx.companyId, createdAt: { gt: new Date(Date.now() - DAY_MS) } } });
    if (sent >= limit) {
      throw new AppError('rate_limited', `Лимит: не больше ${limit} приглашений от компании за сутки`, 429, { limit });
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
  return rows.map((r) => ({
    liveDefense: live.get(r.id) ?? null,
    id: r.id,
    status: r.status,
    salaryFrom: r.salaryFrom,
    salaryTo: r.salaryTo,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    viewedAt: r.viewedAt?.toISOString() ?? null,
    respondedAt: r.respondedAt?.toISOString() ?? null,
    hiredAt: r.hiredAt?.toISOString() ?? null,
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
  return rows.map((r) => {
    const co = r.company ?? r.vacancy?.company ?? { id: null, name: 'Компания', description: null, contact: null };
    const senderEmail = r.employerProfile?.user.email;
    const t = co.id ? trusts.get(co.id) : undefined;
    const company = {
      name: co.name,
      description: co.description,
      contact: co.contact?.trim() || (senderEmail ? contactEmail(senderEmail) : null),
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
      company,
      redFlags: detectRedFlags({
        texts: [r.message, r.vacancy?.title, r.vacancy?.teamDescription],
        salaryFrom: r.salaryFrom,
        salaryTo: r.salaryTo,
      }).map(({ code, severity, candidateNote }) => ({ code, severity, candidateNote })),
      disclosed: disclosed.has(r.id),
      liveDefense: live.get(r.id) ?? null,
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
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, companyId }, select: { status: true, hiredAt: true } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  if (inv.status === 'hired') return { id: invitationId, status: 'hired', hiredAt: (inv.hiredAt ?? new Date()).toISOString() };
  if (inv.status !== 'accepted') throw errors.conflict('Отметить найм можно только по принятому приглашению');
  const now = new Date();
  const r = await prisma.invitation.updateMany({ where: { id: invitationId, companyId, status: 'accepted' }, data: { status: 'hired', hiredAt: now } });
  if (r.count === 0) {
    const again = await prisma.invitation.findFirst({ where: { id: invitationId, companyId }, select: { status: true, hiredAt: true } });
    if (again?.status === 'hired') return { id: invitationId, status: 'hired', hiredAt: (again.hiredAt ?? now).toISOString() };
    throw errors.conflict('Отметить найм можно только по принятому приглашению');
  }
  await closeLiveDefensesOnHire(companyId, invitationId, now);
  void notifyInBackground('ats', () => notifyAtsStatusChanged(invitationId));
  return { id: invitationId, status: 'hired', hiredAt: now.toISOString() };
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
