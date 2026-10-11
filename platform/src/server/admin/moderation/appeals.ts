import 'server-only';

import type { SanctionAppealStatus } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { complaintWindowStart, invitationSanction, type InvitationSanction } from '@/server/employer/antifraud';
import { countRecentComplaints } from '@/server/employer/complaints';
import { lockCompanyInvites } from '@/server/employer/invite-lock';
import { pseudonym } from '@/server/employer/privacy';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';

import { notifyComplaintOutcome } from './complaints';
import { appealOutcomeMail, sendAfterDecision } from './mails';

/**
 * Апелляция работодателя на санкцию (E-08, фаза 2). Санкция — производная от жалоб за окно (antifraud.invitationSanction),
 * своего поля «снять санкцию» в схеме нет. Поэтому удовлетворённая апелляция = модератор отклоняет (dismissed) выбранные
 * открытые жалобы, на которых держится санкция, — тот же механизм, что и решение по одной жалобе, в одной транзакции
 * под advisory-lock отправки. Подтверждённые модератором жалобы (upheld) апелляцией не снимаются.
 */

export const APPEAL_TEXT = { min: 20, max: 2000 } as const;

export interface CompanyAppealView {
  id: string;
  status: SanctionAppealStatus;
  text: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const view = (a: { id: string; status: SanctionAppealStatus; text: string; resolution: string | null; createdAt: Date; resolvedAt: Date | null }): CompanyAppealView => ({
  id: a.id,
  status: a.status,
  text: a.text,
  resolution: a.resolution,
  createdAt: a.createdAt.toISOString(),
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
});

/** Апелляции своей компании, новые сверху (кабинет работодателя). */
export async function listCompanyAppeals(companyId: string): Promise<CompanyAppealView[]> {
  return (await prisma.sanctionAppeal.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 20 })).map(view);
}

/** Оспорить санкцию. Санкции нет — 409; уже есть открытая апелляция — 409. Проверка и вставка под lock компании. */
export async function createSanctionAppeal(ctx: { companyId: string; employerProfileId: string }, rawText: string): Promise<CompanyAppealView> {
  const text = rawText.trim();
  if (text.length < APPEAL_TEXT.min) throw errors.badRequest(`Опишите, почему вы не согласны (от ${APPEAL_TEXT.min} символов)`);
  if (text.length > APPEAL_TEXT.max) throw errors.badRequest('Текст апелляции слишком длинный');
  return prisma.$transaction(async (tx) => {
    await lockCompanyInvites(tx, ctx.companyId);
    const sanction = invitationSanction(await countRecentComplaints(tx, ctx.companyId), DAILY_INVITATION_LIMIT);
    if (sanction.level === 'none') throw errors.conflict('Ограничений нет - оспаривать нечего');
    const open = await tx.sanctionAppeal.count({ where: { companyId: ctx.companyId, status: 'open' } });
    if (open > 0) throw errors.conflict('Апелляция уже на рассмотрении');
    return view(await tx.sanctionAppeal.create({ data: { companyId: ctx.companyId, authorId: ctx.employerProfileId, text } }));
  });
}

export interface AppealQueueItem extends CompanyAppealView {
  company: { id: string; name: string };
  sanction: InvitationSanction;
  /** Жалобы за окно, на которых держится санкция (кроме dismissed): кандидаты — псевдонимы. */
  complaints: { id: string; status: string; reason: string; comment: string | null; candidate: string; createdAt: string }[];
}

export async function listAppeals(status: SanctionAppealStatus | 'all' = 'open'): Promise<AppealQueueItem[]> {
  const rows = await prisma.sanctionAppeal.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: status === 'open' ? { createdAt: 'asc' } : { createdAt: 'desc' },
    take: 100,
    include: { company: { select: { id: true, name: true } } },
  });
  const out: AppealQueueItem[] = [];
  for (const r of rows) {
    const complaints = await prisma.complaint.findMany({
      where: { companyId: r.companyId, status: { not: 'dismissed' }, createdAt: { gt: complaintWindowStart() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, reason: true, comment: true, candidateId: true, createdAt: true },
    });
    out.push({
      ...view(r),
      company: r.company,
      sanction: invitationSanction(complaints.length, DAILY_INVITATION_LIMIT),
      complaints: complaints.map((c) => ({ id: c.id, status: c.status, reason: c.reason, comment: c.comment, candidate: pseudonym(c.candidateId), createdAt: c.createdAt.toISOString() })),
    });
  }
  return out;
}

export interface AppealResolution {
  id: string;
  status: 'upheld' | 'rejected';
  dismissedComplaintIds: string[];
  sanctionBefore: InvitationSanction;
  sanctionAfter: InvitationSanction;
}

/**
 * Решение по апелляции. upheld — отклонить жалобы `complaintIds` (по умолчанию все открытые жалобы компании за окно);
 * в списке можно указать только открытые жалобы этой компании за окно, иначе 400. rejected — санкция не меняется.
 * Журнал: строка на апелляцию и строка на каждую отклонённую жалобу. Письма — после COMMIT.
 */
export async function resolveAppeal(staff: StaffContext, id: string, decision: 'upheld' | 'rejected', rawReason: string, complaintIds?: string[]): Promise<AppealResolution> {
  const reason = requireReason(rawReason);
  const head = await prisma.sanctionAppeal.findUnique({ where: { id }, select: { companyId: true } });
  if (!head) throw errors.notFound('Апелляция не найдена');
  const res = await prisma.$transaction(async (tx) => {
    await lockCompanyInvites(tx, head.companyId);
    const before = await tx.sanctionAppeal.findUniqueOrThrow({ where: { id } });
    if (before.status !== 'open') throw errors.conflict('Апелляция уже рассмотрена');
    const sanctionBefore = invitationSanction(await countRecentComplaints(tx, head.companyId), DAILY_INVITATION_LIMIT);
    let dismissed: string[] = [];
    if (decision === 'upheld') {
      const openIds = (await tx.complaint.findMany({ where: { companyId: head.companyId, status: 'open', createdAt: { gt: complaintWindowStart() } }, select: { id: true } })).map((c) => c.id);
      const chosen = complaintIds ?? openIds;
      const foreign = chosen.filter((c) => !openIds.includes(c));
      if (foreign.length) throw errors.badRequest('Апелляцией можно отклонить только открытые жалобы этой компании за окно');
      const now = new Date();
      const note = `Апелляция компании удовлетворена: ${reason}`;
      for (const cid of chosen) {
        const cb = await tx.complaint.findUniqueOrThrow({ where: { id: cid } });
        const ca = await tx.complaint.update({ where: { id: cid }, data: { status: 'dismissed', resolvedById: staff.staffId, resolvedAt: now, resolution: note } });
        await audit({ actor: staff, action: 'resolve_appeal.dismiss_complaint', target: { type: 'complaint', id: cid }, reason, before: cb, after: { ...ca, appealId: id } }, tx);
      }
      dismissed = chosen;
    }
    const after = await tx.sanctionAppeal.update({ where: { id }, data: { status: decision, resolvedById: staff.staffId, resolvedAt: new Date(), resolution: reason } });
    const sanctionAfter = invitationSanction(await countRecentComplaints(tx, head.companyId), DAILY_INVITATION_LIMIT);
    await audit({ actor: staff, action: `resolve_appeal.${decision}`, target: { type: 'appeal', id }, reason, before: { ...before, sanction: sanctionBefore }, after: { ...after, sanction: sanctionAfter, dismissedComplaintIds: dismissed } }, tx);
    return { id, status: decision, dismissedComplaintIds: dismissed, sanctionBefore, sanctionAfter, authorId: before.authorId };
  });
  const author = res.authorId ? await prisma.employerProfile.findUnique({ where: { id: res.authorId }, select: { user: { select: { email: true } } } }) : null;
  await Promise.all([
    sendAfterDecision('appeal_outcome', author?.user.email, (to) => appealOutcomeMail(to, { upheld: decision === 'upheld', resolution: reason, dismissed: res.dismissedComplaintIds.length })),
    res.dismissedComplaintIds.length ? notifyComplaintOutcome(res.dismissedComplaintIds) : Promise.resolve(),
  ]);
  return { id: res.id, status: res.status, dismissedComplaintIds: res.dismissedComplaintIds, sanctionBefore: res.sanctionBefore, sanctionAfter: res.sanctionAfter };
}
