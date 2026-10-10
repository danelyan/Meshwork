// Кто что видит в созвоне (ADR 0003, п. 4; R-C-16, образец — employer/privacy.ts):
//  - кандидат — свой созвон целиком и запись всегда;
//  - работодатель — до принятого приглашения только оценки по темам (без цитат, транскрипта и записи);
//    после accepted — всё; участник комнаты (defense-room) — транскрипт вживую, запись — только после accepted.
import { prisma } from '../db';
import { errors } from '../errors';
import type { CallAccess, CallVerdict, PublicCallVerdict } from './types';

export interface CallPrincipal {
  role: 'candidate' | 'employer';
  candidateId?: string | null;
  userId?: string | null;
  employerProfileId?: string | null;
}

export interface ResolvedAccess {
  role: 'candidate' | 'employer';
  access: CallAccess;
  /** Можно ли отдавать аудио. */
  recording: boolean;
}

/** Есть ли у компании работодателя принятое приглашение этого кандидата. */
export async function hasAcceptedInvitation(employerProfileId: string, candidateId: string): Promise<boolean> {
  const p = await prisma.employerProfile.findUnique({ where: { id: employerProfileId }, select: { companyId: true } });
  if (!p) return false;
  const n = await prisma.invitation.count({ where: { companyId: p.companyId, candidateId, status: 'accepted' } });
  return n > 0;
}

/**
 * Решение по доступу. Чужой кандидату созвон и созвон скрытого кандидата без accepted — 404
 * (не раскрываем существование).
 */
export async function resolveCallAccess(
  who: CallPrincipal,
  call: { id: string; candidateId: string },
): Promise<ResolvedAccess> {
  if (who.role === 'candidate') {
    if (!who.candidateId || who.candidateId !== call.candidateId) throw errors.notFound('Созвон не найден');
    return { role: 'candidate', access: 'full', recording: true };
  }
  if (!who.employerProfileId) throw errors.forbidden('Доступно кандидату или работодателю');
  const accepted = await hasAcceptedInvitation(who.employerProfileId, call.candidateId);
  if (accepted) return { role: 'employer', access: 'full', recording: true };
  const participant = who.userId
    ? (await prisma.callParticipant.count({ where: { callSessionId: call.id, userId: who.userId } })) > 0
    : false;
  if (participant) return { role: 'employer', access: 'full', recording: false };
  const cand = await prisma.candidate.findUnique({ where: { id: call.candidateId }, select: { hiddenFromEmployers: true } });
  if (!cand || cand.hiddenFromEmployers) throw errors.notFound('Созвон не найден');
  return { role: 'employer', access: 'summary', recording: false };
}

/** Вердикт без цитат и формулировок кандидата — для работодателя до принятого приглашения. */
export function publicVerdict(v: CallVerdict): PublicCallVerdict {
  return {
    kind: v.kind,
    depthMap: v.depthMap.map((d) => ({
      topic: d.topic,
      catalogId: d.catalogId,
      claimed: d.claimed,
      probed: d.probed,
      maxLevel: d.maxLevel,
      confirmed: d.confirmed,
      scores: d.scores,
      total: d.total,
    })),
    summary: v.summary,
    evaluatedAt: v.evaluatedAt,
    thresholdVersion: v.thresholdVersion,
  };
}
