import 'server-only';

import type { ComplaintReason, ComplaintStatus, Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { invitationSanction, type InvitationSanction } from '@/server/employer/antifraud';
import { countRecentComplaints } from '@/server/employer/complaints';
import { lockCompanyInvites } from '@/server/employer/invite-lock';
import { pseudonym } from '@/server/employer/privacy';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';

import { complaintOutcomeMail, sendAfterDecision } from './mails';

/**
 * Очередь жалоб кандидатов (E-08, фаза 2). Санкция и индекс доверия компании считаются на лету из жалоб
 * «кроме dismissed» (employer/complaints.countRecentComplaints, employer/company.loadCompanyTrusts), поэтому
 * отклонение жалобы само убирает её из обоих. Решение принимается под тем же advisory-lock, что и
 * createInvitation: отправка видит санкцию либо до решения, либо после, а не посередине.
 */

export type ComplaintDecision = 'upheld' | 'dismissed';

export interface ComplaintQueueItem {
  id: string;
  status: ComplaintStatus;
  reason: ComplaintReason;
  comment: string | null;
  createdAt: string;
  candidate: string;
  company: { id: string; name: string };
  invitation: { id: string; status: string; salaryFrom: number; salaryTo: number; message: string | null; vacancyTitle: string | null; createdAt: string };
  /** Жалобы на ту же компанию от других кандидатов за всё время (по статусам) и с той же причиной. */
  companyHistory: { open: number; upheld: number; dismissed: number; sameReasonOtherCandidates: number };
  sanction: InvitationSanction;
  resolution: string | null;
  resolvedAt: string | null;
}

const select = {
  id: true,
  status: true,
  reason: true,
  comment: true,
  createdAt: true,
  candidateId: true,
  companyId: true,
  resolution: true,
  resolvedAt: true,
  company: { select: { id: true, name: true } },
  invitation: { select: { id: true, status: true, salaryFrom: true, salaryTo: true, message: true, createdAt: true, vacancy: { select: { title: true } } } },
} satisfies Prisma.ComplaintSelect;

export async function listComplaints(status: ComplaintStatus | 'all' = 'open', limit = 100): Promise<ComplaintQueueItem[]> {
  const rows = await prisma.complaint.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: status === 'open' ? { createdAt: 'asc' } : { createdAt: 'desc' },
    take: limit,
    select,
  });
  const companyIds = [...new Set(rows.map((r) => r.companyId))];
  const [byStatus, all] = await Promise.all([
    prisma.complaint.groupBy({ by: ['companyId', 'status'], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
    prisma.complaint.findMany({ where: { companyId: { in: companyIds } }, select: { companyId: true, candidateId: true, reason: true } }),
  ]);
  const sanctions = new Map<string, InvitationSanction>();
  for (const id of companyIds) sanctions.set(id, invitationSanction(await countRecentComplaints(prisma, id), DAILY_INVITATION_LIMIT));
  return rows.map((r) => {
    const n = (s: ComplaintStatus) => byStatus.find((x) => x.companyId === r.companyId && x.status === s)?._count._all ?? 0;
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      candidate: pseudonym(r.candidateId),
      company: r.company,
      invitation: {
        id: r.invitation.id,
        status: r.invitation.status,
        salaryFrom: r.invitation.salaryFrom,
        salaryTo: r.invitation.salaryTo,
        message: r.invitation.message,
        vacancyTitle: r.invitation.vacancy?.title ?? null,
        createdAt: r.invitation.createdAt.toISOString(),
      },
      companyHistory: {
        open: n('open'),
        upheld: n('upheld'),
        dismissed: n('dismissed'),
        sameReasonOtherCandidates: new Set(all.filter((x) => x.companyId === r.companyId && x.reason === r.reason && x.candidateId !== r.candidateId).map((x) => x.candidateId)).size,
      },
      sanction: sanctions.get(r.companyId)!,
      resolution: r.resolution,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    };
  });
}

export interface ComplaintResolution {
  id: string;
  status: ComplaintDecision;
  sanctionBefore: InvitationSanction;
  sanctionAfter: InvitationSanction;
}

/**
 * Решение по жалобе: только из `open` (повтор — 409), причина обязательна. Транзакция: advisory-lock компании
 * (как createInvitation) → условный update → журнал с санкцией до/после. Письмо кандидату — после COMMIT.
 */
export async function resolveComplaint(staff: StaffContext, id: string, decision: ComplaintDecision, rawReason: string): Promise<ComplaintResolution> {
  const reason = requireReason(rawReason);
  const head = await prisma.complaint.findUnique({ where: { id }, select: { companyId: true } });
  if (!head) throw errors.notFound('Жалоба не найдена');
  const result = await prisma.$transaction(async (tx) => {
    await lockCompanyInvites(tx, head.companyId);
    const before = await tx.complaint.findUniqueOrThrow({ where: { id } });
    if (before.status !== 'open') throw errors.conflict('Жалоба уже рассмотрена');
    const sanctionBefore = invitationSanction(await countRecentComplaints(tx, head.companyId), DAILY_INVITATION_LIMIT);
    const after = await tx.complaint.update({ where: { id }, data: { status: decision, resolvedById: staff.staffId, resolvedAt: new Date(), resolution: reason } });
    const sanctionAfter = invitationSanction(await countRecentComplaints(tx, head.companyId), DAILY_INVITATION_LIMIT);
    await audit({ actor: staff, action: `resolve_complaint.${decision}`, target: { type: 'complaint', id }, reason, before: { ...before, sanction: sanctionBefore }, after: { ...after, sanction: sanctionAfter } }, tx);
    return { id, status: decision, sanctionBefore, sanctionAfter };
  });
  await notifyComplaintOutcome([id]);
  return result;
}

/** Письма кандидатам об итоге жалоб (после COMMIT). */
export async function notifyComplaintOutcome(ids: string[]): Promise<void> {
  const rows = await prisma.complaint.findMany({ where: { id: { in: ids }, status: { not: 'open' } }, select: { status: true, resolution: true, candidate: { select: { email: true } }, company: { select: { name: true } } } });
  await Promise.all(
    rows.map((r) => sendAfterDecision('complaint_outcome', r.candidate.email, (to) => complaintOutcomeMail(to, { companyName: r.company.name, upheld: r.status === 'upheld', resolution: r.resolution ?? '' }))),
  );
}
