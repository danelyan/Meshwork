// Самоотклик кандидата (R-C-12, «желательно») — дополнение к обратной механике, не замена: основной путь — поиск
// работодателем и приглашение с вилкой. Статусы: sent → viewed (работодатель открыл список) → accepted | declined.
//
// Приватность (R-E-07, ADR 0005): до accepted работодатель видит отклик той же карточкой, что в подборке
// (toCandidateCard: псевдоним «Кандидат #…», категория, публичные утверждения). Имя и контакты — только при
// accepted И действующем согласии identity_disclosure с context { applicationId }. Согласие кандидат даёт при отправке
// отклика (галочка обязательна), отзывает — DELETE /api/consents/identity_disclosure?applicationId=.
//
// hiddenFromEmployers (Г4 отозвано) не мешает откликнуться: отклик — адресное действие кандидата, его карточку видит
// только компания этой потребности и только в списке откликов этой потребности. В поиск и подборки кандидат не
// возвращается, другие компании его не видят — ничего сверх R-E-07 не раскрывается.
import type { ApplicationStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';

import { consentRequired, disclosedApplicationIds, userIdForCandidate } from '../consent/service';
import { consentVersion } from '../consent/texts';
import { prisma } from '../db';
import { AppError, errors } from '../errors';
import { loadCatalog } from '../recommend/evidence';

import { DAILY_APPLICATION_LIMIT, type ApplicationInput } from './application-schemas';
import { dedupeClaims, toCandidateCard, type CandidateCard } from './privacy';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN: ApplicationStatus[] = ['sent', 'viewed'];

/** Открыты ли контакты по отклику: только accepted и действующее раскрытие по нему. Чистая функция. */
export function applicationContactsOpen(status: ApplicationStatus, disclosed: boolean): boolean {
  return status === 'accepted' && disclosed;
}

export interface CandidateApplicationView {
  id: string;
  status: ApplicationStatus;
  message: string | null;
  createdAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  /** Действует раскрытие имени и контактов этой компании (контакты она видит только при accepted). */
  disclosed: boolean;
  vacancy: { id: string; title: string; companyName: string; archived: boolean };
}

export interface EmployerApplicationView {
  id: string;
  status: ApplicationStatus;
  message: string | null;
  createdAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  candidate: CandidateCard;
}

/**
 * Откликнуться на открытую потребность. 404 — нет или архивная; 409 — уже откликался (уникальность vacancyId+candidateId)
 * или не подтверждено раскрытие (consent_required); 429 — лимит за сутки. Лимит — под advisory-lock кандидата.
 */
export async function createApplication(candidateId: string, vacancyId: string, input: z.infer<typeof ApplicationInput>, limit = DAILY_APPLICATION_LIMIT) {
  const vacancy = await prisma.vacancy.findFirst({ where: { id: vacancyId, archivedAt: null }, select: { id: true } });
  if (!vacancy) throw errors.notFound('Вакансия не найдена или закрыта');
  if (!input.disclosureVersion) {
    throw consentRequired('identity_disclosure', 'Чтобы откликнуться, подтвердите раскрытие имени и контактов этой компании, если она примет отклик.');
  }
  if (input.disclosureVersion !== consentVersion('identity_disclosure')) throw errors.conflict('Текст согласия обновился - обновите страницу');
  const userId = await userIdForCandidate(candidateId);
  if (!userId) throw errors.forbidden('Откликнуться может аккаунт кандидата - войдите заново');
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`apply:${candidateId}`}))`;
      const dup = await tx.application.findUnique({ where: { vacancyId_candidateId: { vacancyId, candidateId } }, select: { id: true } });
      if (dup) throw errors.conflict('Вы уже откликались на эту вакансию');
      const sent = await tx.application.count({ where: { candidateId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
      if (sent >= limit) throw new AppError('rate_limited', `Лимит: не больше ${limit} откликов за сутки`, 429, { limit });
      const app = await tx.application.create({
        data: { vacancyId, candidateId, message: input.message || null },
        select: { id: true, status: true },
      });
      await tx.consent.create({
        data: { userId, kind: 'identity_disclosure', version: input.disclosureVersion!, acceptedAt: now, context: { applicationId: app.id } },
      });
      return app;
    });
  } catch (err) {
    // Параллельный отклик на ту же вакансию: lock по кандидату это уже исключает, уникальный индекс — последняя линия.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw errors.conflict('Вы уже откликались на эту вакансию');
    throw err;
  }
}

/** Мои отклики (кандидат, только свои). */
export async function listCandidateApplications(candidateId: string): Promise<CandidateApplicationView[]> {
  const rows = await prisma.application.findMany({
    where: { candidateId },
    select: {
      id: true, status: true, message: true, createdAt: true, viewedAt: true, respondedAt: true,
      vacancy: { select: { id: true, title: true, archivedAt: true, company: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const disclosed = await disclosedApplicationIds(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    viewedAt: r.viewedAt?.toISOString() ?? null,
    respondedAt: r.respondedAt?.toISOString() ?? null,
    disclosed: disclosed.has(r.id),
    vacancy: { id: r.vacancy.id, title: r.vacancy.title, companyName: r.vacancy.company.name, archived: r.vacancy.archivedAt !== null },
  }));
}

/**
 * Отклики по своей потребности (работодатель). Чужая потребность — 404 (не раскрываем существование).
 * markViewed — открытие списка переводит sent → viewed.
 */
export async function listVacancyApplications(companyId: string, vacancyId: string, markViewed = false): Promise<EmployerApplicationView[]> {
  const v = await prisma.vacancy.findFirst({ where: { id: vacancyId, companyId }, select: { id: true } });
  if (!v) throw errors.notFound('Потребность не найдена');
  if (markViewed) {
    await prisma.application.updateMany({ where: { vacancyId, status: 'sent' }, data: { status: 'viewed', viewedAt: new Date() } });
  }
  const rows = await prisma.application.findMany({
    where: { vacancyId },
    select: {
      id: true, status: true, message: true, createdAt: true, viewedAt: true, respondedAt: true,
      candidate: {
        select: {
          id: true, name: true, email: true, contact: true, specialization: true, fspState: true,
          categories: { orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }], take: 1, select: { specialization: true, grade: true } },
          claims: { where: { status: { in: ['confirmed', 'edited'] } }, select: { catalogId: true, level: true, sourceKind: true }, orderBy: { id: 'asc' } },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  if (rows.length === 0) return [];
  const [catalog, disclosed] = await Promise.all([loadCatalog(), disclosedApplicationIds(rows.filter((r) => r.status === 'accepted').map((r) => r.id))]);
  return rows.map((r) => {
    const c = r.candidate;
    return {
      id: r.id,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      viewedAt: r.viewedAt?.toISOString() ?? null,
      respondedAt: r.respondedAt?.toISOString() ?? null,
      candidate: toCandidateCard(
        { id: c.id, name: c.name, email: c.email, contact: c.contact, specialization: c.specialization, fspState: c.fspState, category: c.categories[0] ?? null, claims: dedupeClaims(c.claims, catalog) },
        applicationContactsOpen(r.status, disclosed.has(r.id)),
      ),
    };
  });
}

/** Ответ работодателя. Чужой отклик — 404; уже отвеченный — 409. Условный update — без гонки двойного ответа. */
export async function respondApplication(companyId: string, applicationId: string, action: 'accept' | 'decline') {
  const app = await prisma.application.findFirst({ where: { id: applicationId, vacancy: { companyId } }, select: { id: true } });
  if (!app) throw errors.notFound('Отклик не найден');
  const status: ApplicationStatus = action === 'accept' ? 'accepted' : 'declined';
  const now = new Date();
  const r = await prisma.application.updateMany({
    where: { id: applicationId, status: { in: OPEN } },
    data: { status, respondedAt: now },
  });
  if (r.count === 0) throw errors.conflict('На отклик уже ответили');
  await prisma.application.updateMany({ where: { id: applicationId, viewedAt: null }, data: { viewedAt: now } });
  return { id: applicationId, status };
}

