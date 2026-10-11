import 'server-only';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { companySanction } from '@/server/employer/complaints';
import { loadCompanyTrusts } from '@/server/employer/company';
import { pseudonym } from '@/server/employer/privacy';
import { checkInn } from '@/server/onboarding/inn';

import { DAY_MS, maskEmail, maskName } from './lib';

/**
 * Карточки обзора (E-08, фаза 1, только чтение). ФИО, почта и контакты в карточки не попадают: их отдаёт
 * только `pii.ts` через `revealPii`. Блок «Действия» (блокировки, скрытие, кулдауны, удаление) — фаза 3.
 */

/** Срок ответа на возражение: 30 дней со дня подачи (152-ФЗ, ст. 16; ADR 0005). */
export const OBJECTION_DEADLINE_DAYS = 30;

// --- кандидат ---

export async function getCandidateCard(id: string) {
  const c = await prisma.candidate.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      specialization: true,
      fspState: true,
      isDemo: true,
      hiddenFromEmployers: true,
      consentAt: true,
      createdAt: true,
      subcategoryId: true,
      user: { select: { id: true, role: true, blockedAt: true, blockedUntil: true, blockedReason: true, consents: { orderBy: { acceptedAt: 'desc' }, select: { id: true, kind: true, version: true, acceptedAt: true, revokedAt: true } } } },
      profile: { select: { goal: true, claimedGrade: true, stack: true, workFormats: true, city: true, experienceYears: true, fspParticipation: true, updatedAt: true } },
      categories: { orderBy: { confirmedAt: 'desc' }, select: { id: true, specialization: true, grade: true, subcategoryId: true, source: true, confirmedAt: true } },
      testAttempts: { orderBy: { startedAt: 'desc' }, take: 20, select: { id: true, kind: true, specialization: true, grade: true, status: true, mode: true, startedAt: true, finishedAt: true, integrity: true } },
      claims: { orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, catalogId: true, statement: true, level: true, status: true, confidence: true } },
      invitations: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, status: true, createdAt: true, salaryFrom: true, salaryTo: true, company: { select: { id: true, name: true } }, vacancy: { select: { id: true, title: true } }, complaint: { select: { id: true, status: true, reason: true } } },
      },
      applications: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, status: true, createdAt: true, vacancy: { select: { id: true, title: true } } } },
      complaints: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, reason: true, status: true, createdAt: true, companyId: true, invitationId: true } },
      objections: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, subject: true, status: true, createdAt: true, answeredAt: true } },
      callSessions: { orderBy: { startedAt: 'desc' }, take: 20, select: { id: true, kind: true, status: true, startedAt: true, aiDefense: true } },
      defenseSessions: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, createdAt: true, claim: { select: { catalogId: true } } } },
    },
  });
  if (!c) throw errors.notFound('Кандидат не найден');
  const { email, user, claims, ...rest } = c;
  const claimsByLevel: Record<string, number> = {};
  for (const cl of claims) claimsByLevel[cl.level] = (claimsByLevel[cl.level] ?? 0) + 1;
  return {
    ...rest,
    pseudonym: pseudonym(c.id),
    email: maskEmail(email),
    account: user ? { id: user.id, role: user.role, blocked: !!user.blockedAt, blockedUntil: user.blockedUntil, blockedReason: user.blockedReason } : null,
    consents: (user?.consents ?? []).map((k) => ({ ...k, active: !k.revokedAt })),
    claims,
    claimsByLevel,
    currentCategory: c.categories[0] ?? null,
  };
}

// --- учётная запись ---

export async function getUserCard(id: string) {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      isDemo: true,
      onboardedAt: true,
      emailVerifiedAt: true,
      createdAt: true,
      blockedAt: true,
      blockedUntil: true,
      blockedReason: true,
      candidateId: true,
      accounts: { select: { provider: true } },
      employerProfile: { select: { id: true, company: { select: { id: true, name: true } } } },
      consents: { orderBy: { acceptedAt: 'desc' }, select: { id: true, kind: true, version: true, acceptedAt: true, revokedAt: true } },
    },
  });
  if (!u) throw errors.notFound('Пользователь не найден');
  const { name, email, accounts, consents, ...rest } = u;
  return {
    ...rest,
    name: maskName(name),
    email: maskEmail(email),
    providers: [...new Set(accounts.map((a) => a.provider))],
    consents: consents.map((k) => ({ ...k, active: !k.revokedAt })),
    candidate: u.candidateId ? { id: u.candidateId, pseudonym: pseudonym(u.candidateId) } : null,
  };
}

// --- компания ---

export async function getCompanyCard(id: string) {
  const c = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      industry: true,
      inn: true,
      isDemo: true,
      verifiedAt: true,
      verificationNote: true,
      verificationRequestedAt: true,
      blockedAt: true,
      blockedUntil: true,
      blockedReason: true,
      employers: { orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, user: { select: { id: true, name: true, email: true, blockedAt: true } } } },
      vacancies: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, title: true, grade: true, specialization: true, archivedAt: true, createdAt: true } },
      complaints: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, reason: true, status: true, createdAt: true, invitationId: true } },
    },
  });
  if (!c) throw errors.notFound('Компания не найдена');
  const [byStatus, trusts, sanction, appeals] = await Promise.all([
    prisma.invitation.groupBy({ by: ['status'], where: { companyId: id }, _count: { _all: true } }),
    loadCompanyTrusts([id]),
    companySanction(id),
    prisma.sanctionAppeal.count({ where: { companyId: id } }),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  const sent = byStatus.reduce((s, x) => s + x._count._all, 0);
  const declined = count('declined');
  const { employers, inn, ...rest } = c;
  return {
    ...rest,
    inn,
    innCheck: inn ? { valid: checkInn(inn).ok, note: 'Проверена только контрольная цифра; реестры ФНС не сверяются (демо).' } : null,
    representatives: employers.map((e) => ({ id: e.id, userId: e.user.id, name: maskName(e.user.name), email: maskEmail(e.user.email), blocked: !!e.user.blockedAt, createdAt: e.createdAt })),
    invitationStats: { sent, byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])), declined, declineShare: sent > 0 ? declined / sent : null },
    trust: trusts.get(id) ?? null,
    sanction,
    appeals,
  };
}

// --- потребность ---

export async function getVacancyCard(id: string) {
  const v = await prisma.vacancy.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      specialization: true,
      grade: true,
      subcategoryId: true,
      salaryFrom: true,
      salaryTo: true,
      description: true,
      teamDescription: true,
      stack: true,
      needs: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { id: true, name: true } },
      invitations: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, status: true, candidateId: true, createdAt: true } },
      applications: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, status: true, candidateId: true, createdAt: true } },
    },
  });
  if (!v) throw errors.notFound('Потребность не найдена');
  const { invitations, applications, ...rest } = v;
  return {
    ...rest,
    invitations: invitations.map((i) => ({ id: i.id, status: i.status, candidateId: i.candidateId, candidate: pseudonym(i.candidateId), createdAt: i.createdAt })),
    applications: applications.map((a) => ({ id: a.id, status: a.status, candidateId: a.candidateId, candidate: pseudonym(a.candidateId), createdAt: a.createdAt })),
  };
}

// --- приглашение ---

export async function getInvitationCard(id: string) {
  const i = await prisma.invitation.findUnique({
    where: { id },
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
      closedAt: true,
      candidateId: true,
      sourceApplicationId: true,
      company: { select: { id: true, name: true } },
      vacancy: { select: { id: true, title: true } },
      complaint: { select: { id: true, reason: true, status: true, comment: true, createdAt: true } },
      liveDefenses: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, startsAt: true, cancelReason: true } },
    },
  });
  if (!i) throw errors.notFound('Приглашение не найдено');
  const { candidateId, ...rest } = i;
  return { ...rest, candidate: { id: candidateId, pseudonym: pseudonym(candidateId) } };
}

export function objectionDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + OBJECTION_DEADLINE_DAYS * DAY_MS);
}
