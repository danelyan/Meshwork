// Жалобы кандидатов на полученные приглашения (R-X-01, доп. функционал критерия 6).
// Модерации нет (R-D-05): жалоба сразу учитывается в санкциях компании (antifraud.invitationSanction), пока её
// вручную не отметят dismissed. Подача не меняет статус приглашения: отклонить кандидат может отдельно
// (жалоба на вилку не обязательно означает отказ, а автоматический decline отправил бы письмо работодателю).
import { Prisma, type ComplaintReason, type PrismaClient } from '@prisma/client';

import { prisma } from '../db';
import { errors } from '../errors';

import { complaintWindowStart, invitationSanction, type InvitationSanction } from './antifraud';
import { getSetting } from '@/server/admin/settings';

type Db = PrismaClient | Prisma.TransactionClient;

export interface ComplaintView {
  id: string;
  invitationId: string;
  reason: ComplaintReason;
  createdAt: string;
}

/** Жалобы на компанию за окно (кроме dismissed). `db` — tx, если считать под advisory-lock отправки. */
export async function countRecentComplaints(db: Db, companyId: string, now = new Date(), windowDays?: number): Promise<number> {
  const days = windowDays ?? (await getSetting('employer.complaintWindowDays'));
  return db.complaint.count({ where: { companyId, status: { not: 'dismissed' }, createdAt: { gt: complaintWindowStart(now, days) } } });
}

/** Текущая санкция компании — для показа в кабинете. Решение при отправке принимается заново внутри транзакции. */
export async function companySanction(companyId: string, baseLimit?: number): Promise<InvitationSanction> {
  const [complaints, limit, sanctions] = await Promise.all([countRecentComplaints(prisma, companyId), baseLimit ?? getSetting('employer.dailyInvitationLimit'), getSetting('employer.complaintSanctions')]);
  return invitationSanction(complaints, limit, sanctions);
}

/** Подать жалобу. Чужое или несуществующее приглашение — 404; повторная жалоба на то же приглашение — 409. */
export async function fileComplaint(
  candidateId: string,
  invitationId: string,
  input: { reason: ComplaintReason; comment: string | null },
): Promise<ComplaintView> {
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, candidateId }, select: { id: true, companyId: true, vacancy: { select: { companyId: true } } } });
  if (!inv) throw errors.notFound('Приглашение не найдено');
  // Старые приглашения без companyId — компания через потребность.
  const companyId = inv.companyId ?? inv.vacancy?.companyId;
  if (!companyId) throw errors.conflict('У приглашения нет компании - жалобу не к кому отнести');
  try {
    const row = await prisma.complaint.create({
      data: { invitationId: inv.id, companyId, candidateId, reason: input.reason, comment: input.comment },
      select: { id: true, invitationId: true, reason: true, createdAt: true },
    });
    return { ...row, createdAt: row.createdAt.toISOString() };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw errors.conflict('Жалоба на это приглашение уже отправлена');
    throw err;
  }
}
