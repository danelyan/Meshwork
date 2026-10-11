import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/server/db';
import { loadCompanyTrusts } from '@/server/employer/company';
import { pseudonym } from '@/server/employer/privacy';

import { activeBlockWhere, isBlockedNow } from '../accounts/state';
import { PAGE_SIZE, type Paged, maskEmail, maskName, paged, parsePseudonym, skipOf } from './lib';
import { ApplicationListQuery, CandidateListQuery, CompanyListQuery, InvitationListQuery, UserListQuery, VacancyListQuery } from './queries';

export { ApplicationListQuery, CandidateListQuery, CompanyListQuery, InvitationListQuery, UserListQuery, VacancyListQuery };

/**
 * Списки обзора (E-08, фаза 1). Принципы:
 *  - только чтение, смещённая пагинация по `page` (25 строк), сортировка «новые сверху»;
 *  - ПДн в строках нет: у кандидата – псевдоним, у учётки – маска почты и имени. Полные значения – только
 *    через `revealPii` (карточка, кнопка «Показать» с причиной);
 *  - поиск по почте и имени – только тем, у кого есть право раскрытия (`canSearchPii`): иначе поиск
 *    по маске стал бы способом узнать почту в обход журнала.
 */


// --- пользователи ---

export async function listUsers(q: z.infer<typeof UserListQuery>, canSearchPii: boolean) {
  const and: Prisma.UserWhereInput[] = [];
  if (q.role) and.push({ role: q.role });
  if (q.blocked) and.push(q.blocked === 'yes' ? activeBlockWhere() : { NOT: activeBlockWhere() });
  if (q.demo) and.push({ isDemo: q.demo === 'yes' });
  if (q.q) {
    const or: Prisma.UserWhereInput[] = [{ id: q.q }, { candidateId: q.q }];
    if (canSearchPii) or.push({ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } });
    and.push({ OR: or });
  }
  const where: Prisma.UserWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipOf(q.page),
      take: PAGE_SIZE,
      select: { id: true, role: true, name: true, email: true, isDemo: true, onboardedAt: true, createdAt: true, blockedAt: true, blockedUntil: true, candidateId: true, employerProfile: { select: { companyId: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  return paged(
    rows.map((u) => ({
      id: u.id,
      role: u.role,
      name: maskName(u.name),
      email: maskEmail(u.email),
      isDemo: u.isDemo,
      onboarded: !!u.onboardedAt,
      blocked: isBlockedNow(u),
      createdAt: u.createdAt,
      candidateId: u.candidateId,
      companyId: u.employerProfile?.companyId ?? null,
    })),
    total,
    q.page,
  );
}

// --- кандидаты ---

/** Идентификаторы кандидатов с этим псевдонимом: он считается из id хэшем, в БД не хранится – сверяем в коде. */
async function idsByPseudonym(tag: string): Promise<string[]> {
  const all = await prisma.candidate.findMany({ select: { id: true } });
  return all.filter((c) => pseudonym(c.id).endsWith(tag)).map((c) => c.id);
}

export async function listCandidates(q: z.infer<typeof CandidateListQuery>, canSearchPii: boolean) {
  const and: Prisma.CandidateWhereInput[] = [];
  if (q.specialization) and.push({ specialization: q.specialization });
  if (q.grade) and.push({ categories: { some: { grade: q.grade } } });
  if (q.fsp) and.push({ fspState: q.fsp });
  if (q.hidden) and.push({ hiddenFromEmployers: q.hidden === 'yes' });
  if (q.demo) and.push({ isDemo: q.demo === 'yes' });
  if (q.q) {
    const or: Prisma.CandidateWhereInput[] = [{ id: q.q }];
    const tag = parsePseudonym(q.q);
    if (tag) or.push({ id: { in: await idsByPseudonym(tag) } });
    if (canSearchPii) or.push({ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } });
    and.push({ OR: or });
  }
  const where: Prisma.CandidateWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.candidate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipOf(q.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        specialization: true,
        fspState: true,
        hiddenFromEmployers: true,
        isDemo: true,
        createdAt: true,
        categories: { orderBy: { confirmedAt: 'desc' }, take: 1, select: { specialization: true, grade: true, confirmedAt: true } },
      },
    }),
    prisma.candidate.count({ where }),
  ]);
  return paged(
    rows.map((c) => ({
      id: c.id,
      pseudonym: pseudonym(c.id),
      email: maskEmail(c.email),
      specialization: c.specialization,
      category: c.categories[0] ? { specialization: c.categories[0].specialization, grade: c.categories[0].grade, confirmedAt: c.categories[0].confirmedAt } : null,
      fspState: c.fspState,
      hidden: c.hiddenFromEmployers,
      isDemo: c.isDemo,
      createdAt: c.createdAt,
    })),
    total,
    q.page,
  );
}

// --- компании ---

export async function listCompanies(q: z.infer<typeof CompanyListQuery>) {
  const and: Prisma.CompanyWhereInput[] = [];
  if (q.verified === 'yes') and.push({ verifiedAt: { not: null } });
  if (q.verified === 'no') and.push({ verifiedAt: null });
  if (q.verified === 'requested') and.push({ verifiedAt: null, verificationRequestedAt: { not: null } });
  if (q.blocked) and.push(q.blocked === 'yes' ? activeBlockWhere() : { NOT: activeBlockWhere() });
  if (q.q) and.push({ OR: [{ id: q.q }, { name: { contains: q.q, mode: 'insensitive' } }, { inn: { contains: q.q } }] });
  const where: Prisma.CompanyWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      skip: skipOf(q.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        inn: true,
        industry: true,
        isDemo: true,
        verifiedAt: true,
        verificationRequestedAt: true,
        blockedAt: true,
        blockedUntil: true,
        _count: { select: { vacancies: true, invitations: true, employers: true } },
      },
    }),
    prisma.company.count({ where }),
  ]);
  // Индекс доверия считает существующий loadCompanyTrusts (server/employer/company.ts) – формулу не дублируем.
  const trusts = await loadCompanyTrusts(rows.map((c) => c.id));
  return paged(
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      inn: c.inn,
      industry: c.industry,
      isDemo: c.isDemo,
      verified: !!c.verifiedAt,
      verificationRequested: !!c.verificationRequestedAt && !c.verifiedAt,
      blocked: isBlockedNow(c),
      vacancies: c._count.vacancies,
      invitations: c._count.invitations,
      representatives: c._count.employers,
      trust: trusts.get(c.id)?.index ?? null,
      trustBand: trusts.get(c.id)?.band ?? null,
    })),
    total,
    q.page,
  );
}

// --- потребности и вакансии ---

export async function listVacancies(q: z.infer<typeof VacancyListQuery>) {
  const and: Prisma.VacancyWhereInput[] = [];
  if (q.specialization) and.push({ specialization: q.specialization });
  if (q.grade) and.push({ grade: q.grade });
  if (q.state) and.push(q.state === 'archived' ? { archivedAt: { not: null } } : { archivedAt: null });
  if (q.companyId) and.push({ companyId: q.companyId });
  if (q.q) and.push({ OR: [{ id: q.q }, { title: { contains: q.q, mode: 'insensitive' } }, { company: { name: { contains: q.q, mode: 'insensitive' } } }] });
  const where: Prisma.VacancyWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.vacancy.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipOf(q.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        specialization: true,
        grade: true,
        salaryFrom: true,
        salaryTo: true,
        archivedAt: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
        _count: { select: { invitations: true, applications: true } },
      },
    }),
    prisma.vacancy.count({ where }),
  ]);
  return paged(
    rows.map((v) => ({
      id: v.id,
      title: v.title,
      specialization: v.specialization,
      grade: v.grade,
      salaryFrom: v.salaryFrom,
      salaryTo: v.salaryTo,
      archived: !!v.archivedAt,
      createdAt: v.createdAt,
      company: v.company,
      invitations: v._count.invitations,
      applications: v._count.applications,
    })),
    total,
    q.page,
  );
}

// --- приглашения ---


export async function listInvitations(q: z.infer<typeof InvitationListQuery>) {
  const and: Prisma.InvitationWhereInput[] = [];
  if (q.status) and.push({ status: q.status });
  if (q.complaint) and.push({ complaint: { isNot: null } });
  if (q.companyId) and.push({ companyId: q.companyId });
  if (q.candidateId) and.push({ candidateId: q.candidateId });
  if (q.q) and.push({ OR: [{ id: q.q }, { company: { name: { contains: q.q, mode: 'insensitive' } } }, { vacancy: { title: { contains: q.q, mode: 'insensitive' } } }] });
  const where: Prisma.InvitationWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipOf(q.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        salaryFrom: true,
        salaryTo: true,
        createdAt: true,
        candidateId: true,
        company: { select: { id: true, name: true } },
        vacancy: { select: { id: true, title: true } },
        complaint: { select: { status: true } },
      },
    }),
    prisma.invitation.count({ where }),
  ]);
  return paged(
    rows.map((i) => ({
      id: i.id,
      status: i.status,
      salaryFrom: i.salaryFrom,
      salaryTo: i.salaryTo,
      createdAt: i.createdAt,
      candidateId: i.candidateId,
      candidate: pseudonym(i.candidateId),
      company: i.company,
      vacancy: i.vacancy,
      complaint: i.complaint?.status ?? null,
    })),
    total,
    q.page,
  );
}

// --- самоотклики ---

export async function listApplications(q: z.infer<typeof ApplicationListQuery>) {
  const and: Prisma.ApplicationWhereInput[] = [];
  if (q.status) and.push({ status: q.status });
  if (q.vacancyId) and.push({ vacancyId: q.vacancyId });
  if (q.q) and.push({ OR: [{ id: q.q }, { candidateId: q.q }, { vacancy: { title: { contains: q.q, mode: 'insensitive' } } }, { vacancy: { company: { name: { contains: q.q, mode: 'insensitive' } } } }] });
  const where: Prisma.ApplicationWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipOf(q.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        createdAt: true,
        closeReason: true,
        candidateId: true,
        vacancy: { select: { id: true, title: true, company: { select: { id: true, name: true } } } },
        invitation: { select: { id: true } },
      },
    }),
    prisma.application.count({ where }),
  ]);
  return paged(
    rows.map((a) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      closeReason: a.closeReason,
      candidateId: a.candidateId,
      candidate: pseudonym(a.candidateId),
      vacancy: { id: a.vacancy.id, title: a.vacancy.title },
      company: a.vacancy.company,
      invitationId: a.invitation?.id ?? null,
    })),
    total,
    q.page,
  );
}

export type { Paged };
