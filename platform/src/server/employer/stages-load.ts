// Загрузка свидетельств ступеней 1–3 (ADR 0003) для пула кандидатов: пакетно, по трём запросам на весь пул.
// Приватность: вердикт созвона проходит через `publicVerdict` лейна call (темы и баллы, без цитат и формулировок
// кандидата – то, что работодатель видит до принятого приглашения, call/access.ts), защита – только баллы и флаги.
import { Prisma } from '@prisma/client';

import { publicVerdict } from '../call/access';
import type { CallVerdict } from '../call/types';
import { prisma } from '../db';
import type { DefenseRoomVerdict } from '../defense-room/types';
import { defenseVisibleTo } from '../defense-room/visibility';
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

/**
 * Свидетельства созвонов и проектов кандидатов пула; кандидата без ступеней в карте нет.
 * Защита – только видимая компании `companyId` (ADR 0008, defense-room/visibility.ts): ИИ-защита или своя живая.
 * Чужая живая защита сюда не попадает вовсе, поэтому не влияет ни на карточку, ни на текст пояснения.
 */
export async function loadStageEvidence(candidateIds: string[], companyId: string | null = null): Promise<Map<string, StageEvidence>> {
  const out = new Map<string, StageEvidence>();
  if (candidateIds.length === 0) return out;
  const slot = (id: string): StageEvidence => {
    let e = out.get(id);
    if (!e) out.set(id, (e = {}));
    return e;
  };

  // Последний завершённый созвон каждого вида с вердиктом (distinct по кандидату и виду). Защиты – отдельным
  // запросом с фильтром видимости: иначе distinct взял бы самую свежую защиту любого вида, в том числе чужую живую.
  // Пустой вердикт (DB NULL или JSON null) не должен затенять более старый валидный: distinct берёт первую строку.
  const finished = { candidateId: { in: candidateIds }, status: 'finished', NOT: { verdictJson: { equals: Prisma.AnyNull } } } satisfies Prisma.CallSessionWhereInput;
  const order = [{ finishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }] satisfies Prisma.CallSessionOrderByWithRelationInput[];
  const select = { candidateId: true, kind: true, projectSubmissionId: true, verdictJson: true, aiDefense: true } as const;
  const [talks, defenses] = await Promise.all([
    prisma.callSession.findMany({ where: { ...finished, kind: { in: ['qualifying', 'interview'] } }, orderBy: order, distinct: ['candidateId', 'kind'], select }),
    prisma.callSession.findMany({ where: { ...finished, kind: 'defense', AND: [defenseVisibleTo(companyId)] }, orderBy: order, distinct: ['candidateId'], select }),
  ]);
  for (const c of [...talks, ...defenses]) {
    if (!isObject(c.verdictJson)) continue;
    if (c.kind === 'qualifying' || c.kind === 'interview') {
      // ИИнтервью (kind=interview, открывается после теста) строит ту же карту глубины, что и квалифицирующий созвон;
      // для работодателя это одна ступень 1. Если есть оба – берём более свежий вердикт.
      const v = c.verdictJson as unknown as CallVerdict;
      if (!Array.isArray(v.depthMap)) continue;
      const prev = slot(c.candidateId).calls?.qualifying;
      if (prev && prev.evaluatedAt >= (v.evaluatedAt ?? '')) continue;
      slot(c.candidateId).calls = { ...slot(c.candidateId).calls, qualifying: summarizeQualifying(publicVerdict(v)) };
    } else {
      const v = c.verdictJson as unknown as DefenseRoomVerdict;
      if (!Array.isArray(v.flags)) continue;
      slot(c.candidateId).calls = { ...slot(c.candidateId).calls, defense: { ...summarizeDefense(v, c.projectSubmissionId), ...(c.aiDefense ? { ai: true } : {}) } };
    }
  }

  // Проверенные сабмиты: по одному на задание – последний проверенный (повторная сдача заменяет прежнюю).
  const subs = await prisma.projectSubmission.findMany({
    where: { candidateId: { in: candidateIds }, status: 'checked', NOT: { resultJson: { equals: Prisma.AnyNull } } },
    orderBy: [{ checkedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
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
