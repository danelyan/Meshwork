// Загрузка свидетельств ступеней 1–3 (ADR 0003) для пула кандидатов: пакетно, по трём запросам на весь пул.
// Приватность: вердикт созвона проходит через `publicVerdict` лейна call (темы и баллы, без цитат и формулировок
// кандидата — то, что работодатель видит до принятого приглашения, call/access.ts), защита — только баллы и флаги.
import { publicVerdict } from '../call/access';
import type { CallVerdict } from '../call/types';
import { prisma } from '../db';
import type { DefenseRoomVerdict } from '../defense-room/types';
import type { ResultJson, RubricFlag } from '../project/schemas';

import {
  summarizeDefense,
  summarizeQualifying,
  type CallsEvidence,
  type ProjectEvidence,
  type ProjectFlag,
} from './stages';

export interface StageEvidence {
  calls?: CallsEvidence;
  projects?: ProjectEvidence[];
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Свидетельства созвонов и проектов кандидатов пула; кандидата без ступеней в карте нет. */
export async function loadStageEvidence(candidateIds: string[]): Promise<Map<string, StageEvidence>> {
  const out = new Map<string, StageEvidence>();
  if (candidateIds.length === 0) return out;
  const slot = (id: string): StageEvidence => {
    let e = out.get(id);
    if (!e) out.set(id, (e = {}));
    return e;
  };

  // Последний завершённый созвон каждого вида с вердиктом (distinct по кандидату и виду).
  const calls = await prisma.callSession.findMany({
    where: { candidateId: { in: candidateIds }, status: 'finished' },
    orderBy: [{ finishedAt: 'desc' }, { id: 'asc' }],
    distinct: ['candidateId', 'kind'],
    select: { candidateId: true, kind: true, projectSubmissionId: true, verdictJson: true },
  });
  for (const c of calls) {
    if (!isObject(c.verdictJson)) continue;
    if (c.kind === 'qualifying') {
      const v = c.verdictJson as unknown as CallVerdict;
      if (!Array.isArray(v.depthMap)) continue;
      slot(c.candidateId).calls = { ...slot(c.candidateId).calls, qualifying: summarizeQualifying(publicVerdict(v)) };
    } else {
      const v = c.verdictJson as unknown as DefenseRoomVerdict;
      if (!Array.isArray(v.flags)) continue;
      slot(c.candidateId).calls = { ...slot(c.candidateId).calls, defense: summarizeDefense(v, c.projectSubmissionId) };
    }
  }

  // Проверенные сабмиты: по одному на задание — последний проверенный (повторная сдача заменяет прежнюю).
  const subs = await prisma.projectSubmission.findMany({
    where: { candidateId: { in: candidateIds }, status: 'checked' },
    orderBy: [{ checkedAt: 'desc' }, { id: 'asc' }],
    distinct: ['candidateId', 'projectTaskId'],
    select: {
      id: true,
      candidateId: true,
      late: true,
      checkedAt: true,
      submittedAt: true,
      resultJson: true,
      projectTask: { select: { id: true, vacancyId: true, subcategoryId: true } },
    },
  });
  for (const s of subs) {
    const r = s.resultJson as unknown as ResultJson | null;
    if (!r || !isObject(r.tests) || typeof r.tests.score !== 'number') continue;
    const results = Array.isArray(r.rubric?.results) ? r.rubric.results : [];
    const flags = new Set<ProjectFlag>();
    for (const x of results) if (x.flag) flags.add(x.flag as RubricFlag);
    if (r.rubric?.injectionSuspected) flags.add('possible_prompt_injection');
    if (Array.isArray(r.platformOwnedViolations) && r.platformOwnedViolations.length > 0) flags.add('platform_owned_violation');
    (slot(s.candidateId).projects ??= []).push({
      submissionId: s.id,
      taskId: s.projectTask.id,
      vacancyId: s.projectTask.vacancyId,
      subcategoryId: s.projectTask.subcategoryId,
      score: r.tests.score,
      tests: { passed: r.tests.passed, total: r.tests.total },
      flags: [...flags].sort(),
      late: s.late,
      checkedAt: (s.checkedAt ?? s.submittedAt).toISOString(),
      criteria: results.map((x) => ({
        id: x.id,
        text: x.text,
        source: x.source,
        passed: x.passed,
        evidence: x.evidence,
        ...(x.file !== undefined ? { file: x.file } : {}),
        ...(x.flag ? { flag: x.flag } : {}),
      })),
    });
  }
  return out;
}

/** Ожидающая или идущая защита, к которой работодатель может зайти (страница `/employer/calls/[id]`). */
export interface DefenseRoomLink {
  sessionId: string;
  status: 'active' | 'pending';
}

/**
 * Комната защиты для карточки: защита по сабмиту своей компании или вопросы без сабмита (асинхронная дозащита);
 * чужие сабмиты не показываем. Идущая важнее ожидающей. Вызывать только для кандидатов, принявших приглашение.
 */
export async function loadDefenseRooms(companyId: string, candidateIds: string[]): Promise<Map<string, DefenseRoomLink>> {
  const out = new Map<string, DefenseRoomLink>();
  if (candidateIds.length === 0) return out;
  const rows = await prisma.callSession.findMany({
    where: {
      candidateId: { in: candidateIds },
      kind: 'defense',
      status: { in: ['active', 'pending'] },
      OR: [{ projectSubmissionId: null }, { projectSubmission: { projectTask: { vacancy: { companyId } } } }],
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    select: { id: true, candidateId: true, status: true },
  });
  for (const r of rows) {
    const prev = out.get(r.candidateId);
    if (r.status !== 'active' && r.status !== 'pending') continue;
    if (!prev || (prev.status === 'pending' && r.status === 'active')) out.set(r.candidateId, { sessionId: r.id, status: r.status });
  }
  return out;
}
