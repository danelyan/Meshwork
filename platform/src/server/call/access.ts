// Кто что видит в созвоне (ADR 0003, п. 4; R-C-16, образец — employer/privacy.ts):
//  - кандидат — свой созвон целиком и запись всегда;
//  - работодатель — до принятого приглашения только оценки по темам (без цитат, транскрипта и записи);
//    после accepted с действующим раскрытием (Г5, ADR 0005) — всё; участник комнаты (defense-room) — транскрипт
//    вживую, пока созвон идёт; после завершения или отзыва Г5 — как прочие работодатели (полный доступ только по Г5).
import { disclosedCandidateIds } from '../consent/service';
import { prisma } from '../db';
import { defenseVisibleTo } from '../defense-room/visibility';
import { errors } from '../errors';
import { type CallAccess, type CallEvent, type CallVerdict, depthStatus, type PublicCallVerdict } from './types';
import { isBlockedNow } from '@/server/admin/accounts/state';

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
  // Принятое приглашение с действующим раскрытием (Г5, ADR 0005): отзыв раскрытия закрывает транскрипт и запись.
  return (await disclosedCandidateIds(p.companyId, [candidateId])).has(candidateId);
}

/** Защита видна компании работодателя: ИИ-защита или своя живая (ADR 0008). */
async function defenseOwnedOrAi(employerProfileId: string, callId: string): Promise<boolean> {
  const p = await prisma.employerProfile.findUnique({ where: { id: employerProfileId }, select: { companyId: true } });
  if (!p) return false;
  return (await prisma.callSession.count({ where: { id: callId, ...defenseVisibleTo(p.companyId) } })) > 0;
}

/**
 * Решение по доступу. Чужой кандидату созвон и созвон скрытого кандидата без accepted — 404
 * (не раскрываем существование).
 */
export async function resolveCallAccess(
  who: CallPrincipal,
  call: { id: string; candidateId: string; status?: string | null; kind?: string | null },
): Promise<ResolvedAccess> {
  if (who.role === 'candidate') {
    if (!who.candidateId || who.candidateId !== call.candidateId) throw errors.notFound('Созвон не найден');
    return { role: 'candidate', access: 'full', recording: true };
  }
  if (!who.employerProfileId) throw errors.forbidden('Доступно кандидату или работодателю');
  const accepted = await hasAcceptedInvitation(who.employerProfileId, call.candidateId);
  if (accepted) {
    // Живая защита принадлежит компании, по чьему приглашению прошла (ADR 0008, visibility.ts): accepted у другой
    // компании не открывает её транскрипт и запись - для неё такой защиты нет (404).
    if (call.kind === 'defense' && !(await defenseOwnedOrAi(who.employerProfileId, call.id))) throw errors.notFound('Созвон не найден');
    return { role: 'employer', access: 'full', recording: true };
  }
  // Участник комнаты защиты видит транскрипт только пока звонок идёт (иначе комната не работает); после
  // завершения его доступ такой же, как у прочих работодателей: полный — только при действующем раскрытии (Г5).
  const live = call.status === 'active' || call.status === 'pending';
  const participant = live && who.userId
    ? (await prisma.callParticipant.count({ where: { callSessionId: call.id, userId: who.userId } })) > 0
    : false;
  if (participant) return { role: 'employer', access: 'full', recording: false };
  // Защита проекта до accepted: вердикт — только через /api/employer/project-submissions/{id}/ai-defense (свои вакансии,
  // баллы и флаги, ADR 0008 п. 1); карта глубины созвона (publicVerdict) к вердикту защиты не применима.
  if (call.kind === 'defense') throw errors.notFound('Созвон не найден');
  const cand = await prisma.candidate.findUnique({ where: { id: call.candidateId }, select: { hiddenFromEmployers: true, user: { select: { blockedAt: true, blockedUntil: true } } } });
  if (!cand || cand.hiddenFromEmployers || isBlockedNow(cand.user)) throw errors.notFound('Созвон не найден');
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
      status: depthStatus(d),
      ...(d.extraProbe ? { extraProbe: true } : {}),
      scores: d.scores,
      total: d.total,
    })),
    ...(v.testOwnership ? { testOwnership: { status: v.testOwnership.status, items: v.testOwnership.items.map((i) => ({ title: i.title })) } } : {}),
    summary: v.summary,
    evaluatedAt: v.evaluatedAt,
    thresholdVersion: v.thresholdVersion,
    ...(v.interview ? { interview: v.interview } : {}),
  };
}

/** Что видит зритель с access=summary в SSE: только статус, участники и оценки (вердикт без цитат). */
const SUMMARY_EVENTS = new Set<CallEvent['type']>(['status', 'participant', 'verdict']);

/** Событие шины → что можно отдать этому зрителю; null — не отдавать. */
export function eventForAccess(ev: CallEvent, access: CallAccess): CallEvent | null {
  if (access === 'full') return ev;
  if (!SUMMARY_EVENTS.has(ev.type)) return null;
  if (ev.type === 'verdict' && 'runs' in ev.verdict) return { type: 'verdict', verdict: publicVerdict(ev.verdict as CallVerdict) };
  return ev;
}
