import { disclosedCandidateIds } from '../consent/service';
import { prisma } from '../db';
import { defenseFlagLabel } from '../employer/stages';
import { pseudonym } from '../employer/privacy';
import { AppError, errors } from '../errors';
import type { LlmProvider } from '../llm/types';
import type { DefenseScores } from '../defense/types';
import { startDefenseRoom, type StartDeps, type StartResult } from './session';
import { asTranscript, asVerdict } from './store';
import type { DefenseFlag, DefenseRoomVerdict, QlcType, TranscriptEntry } from './types';
import { QLC_LABEL } from './verdict';
import { isBlockedNow } from '@/server/admin/accounts/state';

/**
 * ИИ-защита проекта до приглашения (ADR 0008 п. 1). Кандидат сам запускает защиту своего проверенного сабмита:
 * та же комната и тот же план вопросов по коду (DefenseRoomPlan, QLC), тот же вердикт A-02 (3 прогона, медиана,
 * флаги), но без работодателей и без очереди их вопросов. Сессия – CallSession kind=defense с `aiDefense = true`.
 *
 * Работодатель до принятого приглашения видит только вердикт под псевдонимом: баллы по рубрике и флаги, без
 * транскрипта, записи, формулировок вопросов (в них код и пути кандидата) и ссылки на репозиторий (ТЗ 2.2 п. 2).
 * После accepted с действующим раскрытием (Г5, ADR 0005) – транскрипт и запись, как у созвонов.
 */

export const AI_DEFENSE_LIMITS = {
  /** Не чаще одного запуска на сабмит за окно (демо-кандидатов не ограничиваем – как у созвонов). */
  windowMs: 24 * 60 * 60 * 1000,
} as const;

export async function startAiDefense(candidateId: string, projectSubmissionId: string, llm: LlmProvider, deps: StartDeps = {}): Promise<StartResult> {
  const sub = await prisma.projectSubmission.findUnique({
    where: { id: projectSubmissionId },
    select: { candidateId: true, status: true, candidate: { select: { isDemo: true } } },
  });
  if (!sub || sub.candidateId !== candidateId) throw errors.notFound('Сабмит проекта не найден');
  if (sub.status !== 'checked') throw errors.conflict('Защитить проект можно после автопроверки');

  // Идущая ИИ-защита возобновляется (startDefenseRoom вернёт её), в лимит не упирается.
  const active = await prisma.callSession.findFirst({
    where: { candidateId, kind: 'defense', aiDefense: true, projectSubmissionId, status: 'active' },
    select: { id: true },
  });
  if (!active && !sub.candidate.isDemo) {
    const last = await prisma.callSession.findFirst({
      where: { candidateId, kind: 'defense', aiDefense: true, projectSubmissionId, startedAt: { gte: new Date(Date.now() - AI_DEFENSE_LIMITS.windowMs) } },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (last) {
      const next = new Date(last.startedAt.getTime() + AI_DEFENSE_LIMITS.windowMs);
      throw new AppError('ai_defense_limit', 'ИИ-защиту одного проекта можно проходить раз в сутки', 429, { nextAt: next.toISOString() });
    }
  }
  return startDefenseRoom(candidateId, { mode: 'project', projectSubmissionId, ai: true }, llm, deps);
}

// ---------------------------------------------------------------------------
// Вердикт для работодателя
// ---------------------------------------------------------------------------

/** Вердикт ИИ-защиты без текста кандидата и кода: баллы по рубрике и флаги. */
export interface PublicAiDefenseVerdict {
  scores: DefenseScores | null;
  total: number | null;
  totalMean: number | null;
  passed: boolean | null;
  flags: DefenseFlag[];
  /** Пояснения к флагам готовыми фразами. */
  notes: string[];
  /** Баллы по вопросам: только тип вопроса, без формулировки и места в коде. */
  items: { type: QlcType | 'employer'; label: string; total: number; passed: boolean }[];
  projectScore: number | null;
  answered: number;
  thresholdVersion: string;
  evaluatedAt: string;
}

export function publicAiDefenseVerdict(v: DefenseRoomVerdict): PublicAiDefenseVerdict {
  return {
    scores: v.scores,
    total: v.total,
    totalMean: v.totalMean ?? v.total,
    passed: v.passed,
    flags: v.flags,
    notes: v.flags.map(defenseFlagLabel),
    items: (v.items ?? []).map((i) => ({ type: i.type, label: QLC_LABEL[i.type], total: i.total, passed: i.passed })),
    projectScore: v.projectScore,
    answered: v.answered,
    thresholdVersion: v.thresholdVersion,
    evaluatedAt: v.evaluatedAt,
  };
}

export interface AiDefenseSummary {
  status: 'active' | 'finished';
  verdict: PublicAiDefenseVerdict | null;
  finishedAt: string | null;
}

export interface EmployerAiDefenseView {
  submissionId: string;
  candidate: { id: string; displayName: string };
  /** Кандидат принял приглашение компании и не отозвал раскрытие (Г5): открыты транскрипт, запись, репозиторий. */
  disclosed: boolean;
  aiDefense: AiDefenseSummary | null;
  /** Только при disclosed. */
  sessionId?: string;
  transcript?: TranscriptEntry[];
  hasRecording?: boolean;
  repoUrl?: string;
}

type SessionRow = { id: string; status: string; verdictJson: unknown; finishedAt: Date | null; audioPath: string | null; transcriptJson: unknown; projectSubmissionId: string | null };

/** Последняя ИИ-защита по каждому сабмиту: завершённая с вердиктом важнее идущей. */
async function latestAiDefenses(submissionIds: string[]): Promise<Map<string, SessionRow>> {
  const out = new Map<string, SessionRow>();
  if (!submissionIds.length) return out;
  const rows = await prisma.callSession.findMany({
    where: { kind: 'defense', aiDefense: true, projectSubmissionId: { in: submissionIds }, status: { in: ['active', 'finished'] } },
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    select: { id: true, status: true, verdictJson: true, finishedAt: true, audioPath: true, transcriptJson: true, projectSubmissionId: true },
  });
  for (const r of rows) {
    const key = r.projectSubmissionId!;
    const prev = out.get(key);
    const done = r.status === 'finished' && asVerdict(r.verdictJson) !== null;
    if (!prev || (done && !(prev.status === 'finished' && asVerdict(prev.verdictJson) !== null))) out.set(key, r);
  }
  return out;
}

function summaryOf(r: SessionRow): AiDefenseSummary {
  const v = r.status === 'finished' ? asVerdict(r.verdictJson) : null;
  return { status: r.status === 'finished' ? 'finished' : 'active', verdict: v ? publicAiDefenseVerdict(v) : null, finishedAt: r.finishedAt?.toISOString() ?? null };
}

/** Публичные вердикты ИИ-защиты для списка сабмитов (вызывающий уже отфильтровал свои вакансии и скрытых). */
export async function aiDefenseSummaries(submissionIds: string[]): Promise<Map<string, AiDefenseSummary>> {
  const rows = await latestAiDefenses(submissionIds);
  return new Map([...rows].map(([k, r]) => [k, summaryOf(r)]));
}

/**
 * Вердикт ИИ-защиты сабмита для работодателя. Только сабмит задания вакансии своей компании и не скрытого
 * кандидата; иначе 404 (не раскрываем существование).
 */
export async function getEmployerAiDefense(companyId: string, submissionId: string): Promise<EmployerAiDefenseView> {
  const s = await prisma.projectSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      candidateId: true,
      repoUrl: true,
      candidate: { select: { name: true, hiddenFromEmployers: true, user: { select: { blockedAt: true, blockedUntil: true } } } },
      projectTask: { select: { vacancy: { select: { companyId: true } } } },
    },
  });
  if (!s || s.projectTask.vacancy.companyId !== companyId || s.candidate.hiddenFromEmployers || isBlockedNow(s.candidate.user)) throw errors.notFound('Сдача не найдена');
  const disclosed = (await disclosedCandidateIds(companyId, [s.candidateId])).has(s.candidateId);
  const row = (await latestAiDefenses([s.id])).get(s.id) ?? null;
  const view: EmployerAiDefenseView = {
    submissionId: s.id,
    candidate: { id: s.candidateId, displayName: disclosed ? s.candidate.name : pseudonym(s.candidateId) },
    disclosed,
    aiDefense: row ? summaryOf(row) : null,
  };
  if (!disclosed) return view;
  return {
    ...view,
    repoUrl: s.repoUrl,
    ...(row ? { sessionId: row.id, transcript: asTranscript(row.transcriptJson), hasRecording: row.audioPath !== null } : {}),
  };
}
