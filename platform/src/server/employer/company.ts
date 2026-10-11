import { z } from 'zod';

import { getSetting } from '../admin/settings';
import { ContactSchema } from '../contact';
import { prisma } from '../db';
import { errors } from '../errors';
import { countEmployerNoShows } from '../live-defense/service';
import { checkInn } from '../onboarding/inn';

import { companyTrust, complaintWindowStart, NO_SHOW_WINDOW_DAYS, type CompanyTrust } from './antifraud';

/** Пределы совпадают с шагами онбординга работодателя (scenario.ts), чтобы одни и те же данные проходили оба пути. */
export const COMPANY_LIMITS = { name: 120, description: 600, industry: 80 } as const;

/** Необязательный текст: пустая строка и null стирают значение. */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .nullable()
    .transform((v) => (v ? v : null));

const InnField = z
  .string()
  .trim()
  .nullable()
  .transform((v, ctx) => {
    const raw = (v ?? '').replace(/\s+/g, '');
    if (!raw) return null;
    const c = checkInn(raw);
    if (!c.ok) {
      ctx.issues.push({ code: 'custom', message: c.reason, input: v });
      return z.NEVER;
    }
    return raw;
  });

/** Пустая строка и null стирают контакт; иначе почта или Telegram (ContactSchema со своим текстом ошибки). */
const ContactField = z.string().trim().nullable().transform((v, ctx) => {
  if (!v) return null;
  const r = ContactSchema.safeParse(v);
  if (!r.success) {
    ctx.issues.push({ code: 'custom', message: r.error.issues[0]?.message ?? 'Некорректный контакт', input: v });
    return z.NEVER;
  }
  return r.data;
});

/** PATCH /api/employer/company: частичная правка; неизвестные поля отвергаются, пустой запрос — тоже. */
export const CompanyPatch = z
  .strictObject({
    name: z.string().trim().min(2, 'Название не короче 2 символов').max(COMPANY_LIMITS.name, `Не длиннее ${COMPANY_LIMITS.name} символов`),
    description: clearableText(COMPANY_LIMITS.description),
    industry: clearableText(COMPANY_LIMITS.industry),
    inn: InnField,
    contact: ContactField,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Нет полей для изменения' });
export type CompanyPatch = z.infer<typeof CompanyPatch>;

export interface CompanyView {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  inn: string | null;
  contact: string | null;
}

const SELECT = { id: true, name: true, description: true, industry: true, inn: true, contact: true } as const;

/** Профиль своей компании. companyId берётся из профиля работодателя в сессии, не из запроса. */
export async function getCompany(companyId: string): Promise<CompanyView> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: SELECT });
  if (!c) throw errors.notFound('Компания не найдена');
  return c;
}

/** Правит только переданные поля своей компании. */
export async function updateCompany(companyId: string, patch: CompanyPatch): Promise<CompanyView> {
  await getCompany(companyId);
  return prisma.company.update({ where: { id: companyId }, data: patch, select: SELECT });
}

/**
 * Индекс доверия компаний (R-X-01, КОНЦЕПЦИЯ) из имеющихся данных: профиль, ИНН, возраст первого представителя,
 * доля отклонённых приглашений, жалобы кандидатов за 30 дней, неявки на назначенные защиты. Четыре запроса на весь список.
 */
export async function loadCompanyTrusts(companyIds: string[], now = new Date()): Promise<Map<string, CompanyTrust>> {
  const ids = [...new Set(companyIds)];
  if (ids.length === 0) return new Map();
  const [weights, complaintPenalty, noShowPenalty, windowDays] = await Promise.all([getSetting('employer.trustWeights'), getSetting('employer.complaintTrustPenalty'), getSetting('employer.noShowTrustPenalty'), getSetting('employer.complaintWindowDays')]);
  const [companies, stats, complaints, noShows] = await Promise.all([
    prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, description: true, industry: true, inn: true, contact: true, employers: { select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    }),
    prisma.invitation.groupBy({ by: ['companyId', 'status'], where: { companyId: { in: ids } }, _count: { _all: true } }),
    // lane complaints: жалобы кандидатов за 30 дней, кроме dismissed.
    prisma.complaint.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, status: { not: 'dismissed' }, createdAt: { gt: complaintWindowStart(now, windowDays) } }, _count: { _all: true } }),
    // lane defense-rules: неявки работодателя на назначенные защиты за 30 дней (вычисляются при чтении).
    countEmployerNoShows(ids, new Date(now.getTime() - NO_SHOW_WINDOW_DAYS * 24 * 60 * 60 * 1000), now),
  ]);
  const out = new Map<string, CompanyTrust>();
  for (const c of companies) {
    const mine = stats.filter((x) => x.companyId === c.id);
    out.set(
      c.id,
      companyTrust({
        name: c.name,
        description: c.description,
        industry: c.industry,
        innValid: !!c.inn && checkInn(c.inn).ok,
        contact: c.contact,
        createdAt: c.employers[0]?.createdAt ?? now,
        invitationsSent: mine.reduce((s, x) => s + x._count._all, 0),
        invitationsDeclined: mine.filter((x) => x.status === 'declined').reduce((s, x) => s + x._count._all, 0),
        complaints: complaints.find((x) => x.companyId === c.id)?._count._all ?? 0,
        noShows: noShows.get(c.id) ?? 0,
        now,
      }, { weights, complaintPenalty, noShowPenalty, complaintWindowDays: windowDays }),
    );
  }
  return out;
}
