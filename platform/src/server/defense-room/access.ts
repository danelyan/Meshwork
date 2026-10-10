import { prisma } from '../db';
import { acceptedCandidateIds } from '../employer/matching';
import { loadEmployerContext } from '../employer/context';
import { errors } from '../errors';
import type { SessionPrincipal } from '../session';
import { CANDIDATE_PEER, employerPeer, type PeerId } from './bus';
import type { CallEvent, CallSnapshot, TranscriptEntry } from './types';

/**
 * Кто смотрит звонок. Кандидат — владелец сессии. Работодатель — только если кандидат принял
 * приглашение его компании (R-C-16, ADR 0003 «Запись»: до контакта — псевдоним, транскрипта нет);
 * иначе 404, как для чужого объекта. Реплики и вопросы других компаний работодателю отдаются скрытыми:
 * кандидат может общаться с несколькими компаниями, и одна не должна видеть другую.
 */

export type Viewer =
  | { role: 'candidate'; candidateId: string; peer: PeerId }
  | { role: 'employer'; userId: string; employerProfileId: string; companyId: string; companyName: string; peer: PeerId };

export interface ViewedSession {
  id: string;
  candidateId: string;
  status: 'active' | 'finished' | 'cancelled';
}

/** Работодатель видит кандидата за пределами псевдонима только после accepted. */
export async function employerMayAccess(companyId: string, candidateId: string): Promise<boolean> {
  return (await acceptedCandidateIds(companyId, [candidateId])).has(candidateId);
}

export async function resolveViewer(principal: SessionPrincipal | null, sessionId: string): Promise<{ viewer: Viewer; session: ViewedSession }> {
  if (!principal) throw errors.unauthorized();
  const s = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { id: true, candidateId: true, kind: true, status: true } });
  if (!s || s.kind !== 'defense') throw errors.notFound('Сессия не найдена');
  if (principal.candidateId && principal.candidateId === s.candidateId) {
    return { viewer: { role: 'candidate', candidateId: s.candidateId, peer: CANDIDATE_PEER }, session: s };
  }
  if (principal.userId && principal.employerProfileId) {
    const ctx = await loadEmployerContext(principal.employerProfileId);
    if (await employerMayAccess(ctx.companyId, s.candidateId)) {
      return {
        viewer: {
          role: 'employer',
          userId: principal.userId,
          employerProfileId: ctx.employerProfileId,
          companyId: ctx.companyId,
          companyName: ctx.companyName,
          peer: employerPeer(principal.userId),
        },
        session: s,
      };
    }
  }
  throw errors.notFound('Сессия не найдена');
}

const HIDDEN = '[реплика другой компании скрыта]';

export function redactEntry(entry: TranscriptEntry, viewer: Viewer): TranscriptEntry {
  const companyId = entry.defense?.companyId;
  if (viewer.role === 'candidate' || !companyId || companyId === viewer.companyId) return entry;
  return {
    index: entry.index,
    role: entry.role,
    at: entry.at,
    tMs: entry.tMs,
    text: HIDDEN,
    ...(entry.defense?.itemId || entry.defense?.kind ? { defense: { ...(entry.defense.itemId ? { itemId: entry.defense.itemId } : {}), ...(entry.defense.kind ? { kind: entry.defense.kind } : {}) } } : {}),
  };
}

export function redactSnapshot(s: CallSnapshot, viewer: Viewer): CallSnapshot {
  if (viewer.role === 'candidate') return s;
  return {
    ...s,
    transcript: s.transcript.map((e) => redactEntry(e, viewer)),
    participants: s.participants.filter((p) => p.companyId === viewer.companyId),
  };
}

/** Событие для конкретного зрителя: null — не показывать. */
export function redactEvent(e: CallEvent, viewer: Viewer): CallEvent | null {
  if (viewer.role === 'candidate') return e;
  switch (e.type) {
    case 'utterance':
      return { ...e, entry: redactEntry(e.entry, viewer) };
    case 'participant':
    case 'question':
      return e.companyId === viewer.companyId ? e : null;
    case 'mute':
      return { ...e, userId: '' };
    case 'snapshot':
      return { ...e, call: redactSnapshot(e.call, viewer) };
    default:
      return e;
  }
}
