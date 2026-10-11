// Индекс честности в порядке выдачи (вариант 2a, решение владельца 11.10): при high категория из теста не учитывается,
// пока её не подтвердит подтверждающий тест (confirmedAgain) или созвон с разбором ЭТОЙ попытки («объяснил сам»).
// Оценка вариантов — eval/matching/integrity.ts, docs/validation-results.md § «Индекс честности в подборе, 11.10».
// Метка работодателю (test-integrity.ts) отсюда не меняется. Загрузка пакетная: 1 запрос на пул + 2 только при high.
import type { Prisma } from '@prisma/client';

import type { TestOwnershipStatus } from '../call/types';
import { prisma } from '../db';
import { getEnv } from '../env';
import type { Grade, Specialization } from '../types';

import type { CandidateEvidence, RankOptions } from './ranking';
import { publicIntegrity } from './test-integrity';

export type RankingIntegrity = NonNullable<CandidateEvidence['testIntegrity']>;

interface CategoryKey {
  specialization: Specialization;
  grade: Grade;
  subcategoryId?: string | null;
}

/** Опции ранжирования кабинета: 2a включён, пока TEST_INTEGRITY_RANKING не выключен. */
export function rankingIntegrityOptions(enabled: boolean = getEnv().TEST_INTEGRITY_RANKING): RankOptions {
  return enabled ? { integrityPenalty: { mode: 'drop_category' } } : {};
}

/** Попытка теста в объёме, нужном для привязки созвона. */
export interface AttemptRef {
  id: string;
  finishedAt: Date | null;
  /** Шаблоны заданий, на которые кандидат ответил (их и разбирает созвон, call/test-review.ts). */
  templateIds: ReadonlySet<string>;
}

/** Созвон с разбором теста: когда начат и какие задания разбирал. */
export interface OwnershipCall {
  startedAt: Date;
  status: TestOwnershipStatus;
  templateIds: readonly string[];
}

/**
 * Какую попытку разбирал созвон. loadTestReview берёт последнюю завершённую попытку направления на момент созвона, а в
 * вердикт пишет только шаблоны заданий, поэтому восстанавливаем так: последняя попытка, завершённая до начала созвона и
 * содержащая все разобранные шаблоны. Нет разобранных заданий — созвон ни к какой попытке не относится.
 */
export function reviewedAttemptId(call: OwnershipCall, attempts: readonly AttemptRef[]): string | null {
  if (call.templateIds.length === 0) return null;
  let best: AttemptRef | null = null;
  for (const a of attempts) {
    if (!a.finishedAt || a.finishedAt > call.startedAt) continue;
    if (!call.templateIds.every((t) => a.templateIds.has(t))) continue;
    if (!best || a.finishedAt > best.finishedAt!) best = a;
  }
  return best?.id ?? null;
}

/**
 * Итог разбора для попытки: статус последнего созвона, который разбирал именно её. Нет такого — null
 * (созвон по другой попытке или без разбора теста понижение не снимает).
 */
export function ownershipForAttempt(attemptId: string, calls: readonly OwnershipCall[], attempts: readonly AttemptRef[]): TestOwnershipStatus | null {
  const mine = calls.filter((c) => reviewedAttemptId(c, attempts) === attemptId).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return mine[0]?.status ?? null;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** testOwnership из сырого вердикта созвона (CallVerdict): статус и id разобранных шаблонов. */
export function parseOwnership(verdict: Prisma.JsonValue | null): { status: TestOwnershipStatus; templateIds: string[] } | null {
  if (!isObject(verdict) || !isObject(verdict.testOwnership)) return null;
  const o = verdict.testOwnership;
  if (o.status !== 'explained' && o.status !== 'partial' && o.status !== 'failed' && o.status !== 'not_checked') return null;
  const items = Array.isArray(o.items) ? o.items : [];
  const templateIds = items.flatMap((i) => (isObject(i) && typeof i.templateId === 'string' ? [i.templateId] : []));
  return { status: o.status, templateIds };
}

/**
 * Индекс честности для ранжирования по всему пулу: попытка, давшая текущую категорию (как в loadTestIntegrity), её
 * публичный уровень, confirmedAgain и ownershipExplained (созвон разобрал эту попытку и кандидат «объяснил сам»).
 * Запросы: попытки всех кандидатов с категорией (1) и источники подтверждающих (≤ 1); только у кандидатов с high без
 * подтверждения — их попытки с ответами (1) и созвоны (1). Без N+1: везде `in` по списку.
 */
export async function loadRankingIntegrity(categories: ReadonlyMap<string, CategoryKey | null>): Promise<Map<string, RankingIntegrity>> {
  const out = new Map<string, RankingIntegrity>();
  const ids = [...categories].filter(([, c]) => c !== null).map(([id]) => id);
  if (ids.length === 0) return out;
  const attempts = await prisma.testAttempt.findMany({
    where: { candidateId: { in: ids }, status: 'passed' },
    select: { id: true, candidateId: true, specialization: true, grade: true, subcategoryId: true, kind: true, confirmsAttemptId: true, integrity: true },
    orderBy: [{ finishedAt: 'desc' }, { id: 'asc' }],
  });
  const picked = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    const c = categories.get(a.candidateId);
    if (!c || picked.has(a.candidateId)) continue;
    if (a.specialization === c.specialization && a.grade === c.grade && (a.subcategoryId ?? null) === (c.subcategoryId ?? null)) picked.set(a.candidateId, a);
  }
  const sourceIds = [...new Set([...picked.values()].map((a) => a.confirmsAttemptId).filter((x): x is string => Boolean(x)))];
  const sources = sourceIds.length ? await prisma.testAttempt.findMany({ where: { id: { in: sourceIds } }, select: { id: true, integrity: true } }) : [];
  const sourceById = new Map(sources.map((s) => [s.id, s.integrity]));
  /** Попытка, чей индекс показан (для подтверждающей — исходная): её и должен был разобрать созвон. */
  const indexAttempt = new Map<string, string>();
  for (const [candidateId, a] of picked) {
    const isConfirm = a.kind === 'confirm' && a.confirmsAttemptId;
    const view = isConfirm ? publicIntegrity(sourceById.get(a.confirmsAttemptId!), true) : publicIntegrity(a.integrity);
    if (!view) continue;
    out.set(candidateId, { level: view.level, confirmedAgain: view.confirmedAgain });
    indexAttempt.set(candidateId, isConfirm ? a.confirmsAttemptId! : a.id);
  }

  const flagged = [...out].filter(([, v]) => v.level === 'high' && !v.confirmedAgain).map(([id]) => id);
  if (flagged.length === 0) return out;
  const [own, calls] = await Promise.all([
    prisma.testAttempt.findMany({
      where: { candidateId: { in: flagged }, status: { in: ['passed', 'not_confirmed'] }, finishedAt: { not: null } },
      select: { id: true, candidateId: true, finishedAt: true, items: { where: { answer: { not: null } }, select: { templateId: true } } },
    }),
    prisma.callSession.findMany({
      where: { candidateId: { in: flagged }, kind: { in: ['qualifying', 'interview'] }, status: 'finished' },
      select: { candidateId: true, startedAt: true, verdictJson: true },
    }),
  ]);
  const attemptsBy = new Map<string, AttemptRef[]>();
  for (const a of own) attemptsBy.set(a.candidateId, [...(attemptsBy.get(a.candidateId) ?? []), { id: a.id, finishedAt: a.finishedAt, templateIds: new Set(a.items.map((i) => i.templateId)) }]);
  const callsBy = new Map<string, OwnershipCall[]>();
  for (const c of calls) {
    const o = parseOwnership(c.verdictJson);
    if (o) callsBy.set(c.candidateId, [...(callsBy.get(c.candidateId) ?? []), { startedAt: c.startedAt, ...o }]);
  }
  for (const id of flagged) {
    const status = ownershipForAttempt(indexAttempt.get(id)!, callsBy.get(id) ?? [], attemptsBy.get(id) ?? []);
    if (status === 'explained') out.set(id, { ...out.get(id)!, ownershipExplained: true });
  }
  return out;
}

/** Кандидаты пула с индексом для ранжирования (копии evidence; без индекса — как были). */
export function withRankingIntegrity(evidence: CandidateEvidence[], integrity: ReadonlyMap<string, RankingIntegrity>): CandidateEvidence[] {
  return evidence.map((c) => (integrity.has(c.id) ? { ...c, testIntegrity: integrity.get(c.id)! } : c));
}
