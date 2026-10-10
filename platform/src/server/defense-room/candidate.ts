import { prisma } from '../db';
import { asVerdict } from './store';
import type { DefenseRoomVerdict } from './types';

/** Что кандидат видит на входе в защиту: свои сабмиты, последние защиты и вопросы работодателей в очереди. */

export interface CandidateSubmissionRow {
  id: string;
  repoUrl: string;
  status: string;
  submittedAt: string;
  lastDefense: { sessionId: string; status: 'active' | 'finished' | 'cancelled' | 'pending'; verdict: DefenseRoomVerdict | null } | null;
}

export async function listCandidateSubmissions(candidateId: string): Promise<CandidateSubmissionRow[]> {
  const subs = await prisma.projectSubmission.findMany({ where: { candidateId }, orderBy: { submittedAt: 'desc' }, take: 20 });
  const calls = await prisma.callSession.findMany({
    where: { candidateId, kind: 'defense', projectSubmissionId: { in: subs.map((s) => s.id) } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, status: true, verdictJson: true, projectSubmissionId: true },
  });
  return subs.map((s) => {
    const c = calls.find((x) => x.projectSubmissionId === s.id);
    return {
      id: s.id,
      repoUrl: s.repoUrl,
      status: s.status,
      submittedAt: s.submittedAt.toISOString(),
      lastDefense: c ? { sessionId: c.id, status: c.status, verdict: asVerdict(c.verdictJson) } : null,
    };
  });
}

export interface PendingQuestions {
  total: number;
  byCompany: { companyName: string; count: number }[];
  /** Идёт сессия «только вопросы» — продолжить её. */
  activeSessionId: string | null;
}

/** «У работодателя N вопросов»: только очередь (asked без ответа после завершения возвращаются в queued). */
export async function pendingEmployerQuestions(candidateId: string): Promise<PendingQuestions> {
  const rows = await prisma.employerQuestion.groupBy({ by: ['companyId'], where: { candidateId, status: 'queued' }, _count: { _all: true } });
  const companies = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true } });
  const active = await prisma.callSession.findFirst({ where: { candidateId, kind: 'defense', status: 'active', projectSubmissionId: null }, select: { id: true } });
  const byCompany = rows.map((r) => ({ companyName: companies.find((c) => c.id === r.companyId)?.name ?? 'компания', count: r._count._all }));
  return { total: byCompany.reduce((n, r) => n + r.count, 0), byCompany, activeSessionId: active?.id ?? null };
}
