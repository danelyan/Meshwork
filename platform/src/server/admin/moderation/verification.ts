import 'server-only';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { checkInn } from '@/server/onboarding/inn';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';

/**
 * Ручная верификация компании модератором (E-08, фаза 2; R-D-05 — вне MVP, решение владельца 11.10). Без API ФНС:
 * представитель присылает реквизиты выписки ЕГРЮЛ (ОГРН, дата, ссылка) или подтверждает домен корпоративной почты
 * (домен берётся из своей подтверждённой почты, не из ввода). Модератор сверяет ИНН и название и ставит метку.
 * Метка видна кандидату на приглашении (listCandidateInvitations → company.verified).
 * Отклонение: verificationRequestedAt снимается, причина — в verificationNote (видна представителю).
 */

/** Бесплатные почтовые домены — не подтверждают принадлежность к компании. */
export const FREE_MAIL = new Set(['gmail.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com', 'proton.me', 'protonmail.com']);

export type VerificationMethod = 'egrul' | 'email_domain';

export interface VerificationEvidence {
  method: VerificationMethod;
  /** egrul: реквизиты выписки; email_domain: комментарий. */
  text: string;
  /** email_domain: домен подтверждённой почты представителя. */
  domain?: string | null;
  requestedBy: string;
}

export interface CompanyVerificationView {
  verified: boolean;
  verifiedAt: string | null;
  requestedAt: string | null;
  note: string | null;
  evidence: VerificationEvidence | null;
}

export function parseEvidence(raw: string | null): VerificationEvidence | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VerificationEvidence;
  } catch {
    return { method: 'egrul', text: raw, requestedBy: '' };
  }
}

export function domainOf(email: string | null | undefined): string | null {
  const m = /@([^@\s]+)$/.exec(email?.trim().toLowerCase() ?? '');
  return m ? m[1]! : null;
}

export async function companyVerification(companyId: string): Promise<CompanyVerificationView> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { verifiedAt: true, verificationRequestedAt: true, verificationNote: true, verificationEvidence: true } });
  if (!c) throw errors.notFound('Компания не найдена');
  return { verified: !!c.verifiedAt, verifiedAt: c.verifiedAt?.toISOString() ?? null, requestedAt: c.verificationRequestedAt?.toISOString() ?? null, note: c.verificationNote, evidence: parseEvidence(c.verificationEvidence) };
}

/**
 * Запрос верификации от представителя. Уже проверена — 409; без ИНН — 409 (модератору нечего сверять);
 * email_domain с бесплатной или неподтверждённой почтой — 400. Повторный запрос перезаписывает основание.
 */
export async function requestVerification(ctx: { companyId: string; employerProfileId: string }, input: { method: VerificationMethod; text: string }): Promise<CompanyVerificationView> {
  const text = input.text.trim();
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { inn: true, verifiedAt: true } });
  if (!company) throw errors.notFound('Компания не найдена');
  if (company.verifiedAt) throw errors.conflict('Компания уже проверена');
  if (!company.inn || !checkInn(company.inn).ok) throw errors.conflict('Сначала укажите ИНН компании в профиле');
  const ev: VerificationEvidence = { method: input.method, text, requestedBy: ctx.employerProfileId };
  if (input.method === 'egrul') {
    if (text.length < 10) throw errors.badRequest('Укажите реквизиты выписки ЕГРЮЛ: ОГРН, дату выписки или ссылку (от 10 символов)');
  } else {
    const p = await prisma.employerProfile.findUnique({ where: { id: ctx.employerProfileId }, select: { user: { select: { email: true, emailVerifiedAt: true } } } });
    const domain = domainOf(p?.user.email);
    if (!domain || !p?.user.emailVerifiedAt) throw errors.badRequest('Подтвердите почту аккаунта: домен берётся из подтверждённой почты');
    if (FREE_MAIL.has(domain) || /\.invalid$/.test(domain)) throw errors.badRequest('Домен бесплатной почты не подтверждает компанию - приложите выписку ЕГРЮЛ');
    ev.domain = domain;
  }
  await prisma.company.update({ where: { id: ctx.companyId }, data: { verificationRequestedAt: new Date(), verificationEvidence: JSON.stringify(ev), verificationNote: null } });
  return companyVerification(ctx.companyId);
}

export interface VerificationQueueItem {
  companyId: string;
  name: string;
  inn: string | null;
  innValid: boolean;
  industry: string | null;
  requestedAt: string | null;
  verifiedAt: string | null;
  note: string | null;
  evidence: VerificationEvidence | null;
  representatives: number;
}

/** pending — ждут решения; verified — проверенные. */
export async function listVerification(filter: 'pending' | 'verified' = 'pending'): Promise<VerificationQueueItem[]> {
  const rows = await prisma.company.findMany({
    where: filter === 'pending' ? { verificationRequestedAt: { not: null }, verifiedAt: null } : { verifiedAt: { not: null } },
    orderBy: filter === 'pending' ? { verificationRequestedAt: 'asc' } : { verifiedAt: 'desc' },
    take: 100,
    select: { id: true, name: true, inn: true, industry: true, verificationRequestedAt: true, verifiedAt: true, verificationNote: true, verificationEvidence: true, _count: { select: { employers: true } } },
  });
  return rows.map((c) => ({
    companyId: c.id,
    name: c.name,
    inn: c.inn,
    innValid: !!c.inn && checkInn(c.inn).ok,
    industry: c.industry,
    requestedAt: c.verificationRequestedAt?.toISOString() ?? null,
    verifiedAt: c.verifiedAt?.toISOString() ?? null,
    note: c.verificationNote,
    evidence: parseEvidence(c.verificationEvidence),
    representatives: c._count.employers,
  }));
}

export type VerificationDecision = 'verify' | 'reject' | 'revoke';

/** verify/reject — только при открытом запросе (409); revoke — только у проверенной (409). Причина обязательна. */
export async function decideVerification(staff: StaffContext, companyId: string, decision: VerificationDecision, rawReason: string): Promise<CompanyVerificationView> {
  const reason = requireReason(rawReason);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`verify:${companyId}`}))`;
    const before = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, inn: true, verifiedAt: true, verifiedById: true, verificationNote: true, verificationRequestedAt: true, verificationEvidence: true } });
    if (!before) throw errors.notFound('Компания не найдена');
    const pending = !!before.verificationRequestedAt && !before.verifiedAt;
    if ((decision === 'verify' || decision === 'reject') && !pending) throw errors.conflict('Нет открытого запроса на проверку');
    if (decision === 'revoke' && !before.verifiedAt) throw errors.conflict('Компания не проверена');
    const data =
      decision === 'verify'
        ? { verifiedAt: new Date(), verifiedById: staff.staffId, verificationNote: reason }
        : decision === 'reject'
          ? { verificationRequestedAt: null, verificationNote: reason }
          : { verifiedAt: null, verifiedById: null, verificationRequestedAt: null, verificationNote: reason };
    const after = await tx.company.update({ where: { id: companyId }, data, select: { id: true, name: true, inn: true, verifiedAt: true, verifiedById: true, verificationNote: true, verificationRequestedAt: true, verificationEvidence: true } });
    await audit({ actor: staff, action: `verify_company.${decision}`, target: { type: 'company', id: companyId }, reason, before, after }, tx);
  });
  return companyVerification(companyId);
}
