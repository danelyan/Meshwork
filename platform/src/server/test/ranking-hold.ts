// Что кандидат видит о влиянии индекса честности на выдачу (аудит 11.10, п. 4). При TEST_INTEGRITY_RANKING
// кабинет работодателя не учитывает категорию с индексом high (employer/integrity-ranking.ts, вариант 2a), пока её
// не подтвердит подтверждающий тест (confirmedBy у исходной попытки) или созвон с разбором именно этой попытки
// («объяснил сам»). Здесь та же логика для одного кандидата: какая попытка держит его категорию вне выдачи.
// Правила выбора попытки и созвона - общие с integrity-ranking.ts, чтобы кандидат и работодатель видели одно и то же.
import { prisma } from '../db';
import { getEnv } from '../env';
import { ownershipForAttempt, parseOwnership, type AttemptRef, type OwnershipCall } from '../employer/integrity-ranking';
import { publicIntegrity } from '../employer/test-integrity';

export interface RankingHold {
  /** Попытка, чей индекс держит категорию вне выдачи (для подтверждающей попытки - исходная). */
  attemptId: string;
}

/**
 * Попытка, из-за которой текущая категория кандидата не учитывается в подборке и поиске; null - выдача учитывает
 * категорию (или категории нет, или TEST_INTEGRITY_RANKING выключен). Текущая категория - последняя подтверждённая,
 * как в employer/matching.ts; её попытка - последняя пройденная с той же специализацией, грейдом и подкатегорией.
 */
export async function rankingHoldOf(candidateId: string): Promise<RankingHold | null> {
  if (!getEnv().TEST_INTEGRITY_RANKING) return null;
  const category = await prisma.candidateCategory.findFirst({
    where: { candidateId },
    orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }],
    select: { specialization: true, grade: true, subcategoryId: true },
  });
  if (!category) return null;
  const picked = await prisma.testAttempt.findFirst({
    where: { candidateId, status: 'passed', specialization: category.specialization, grade: category.grade, subcategoryId: category.subcategoryId },
    orderBy: [{ finishedAt: 'desc' }, { id: 'asc' }],
    select: { id: true, kind: true, confirmsAttemptId: true, integrity: true },
  });
  if (!picked) return null;
  const isConfirm = picked.kind === 'confirm' && picked.confirmsAttemptId !== null;
  const sourceId = isConfirm ? picked.confirmsAttemptId! : picked.id;
  const raw = isConfirm ? (await prisma.testAttempt.findUnique({ where: { id: sourceId }, select: { integrity: true } }))?.integrity : picked.integrity;
  const view = publicIntegrity(raw ?? null, isConfirm);
  if (!view || view.level !== 'high' || view.confirmedAgain) return null;

  const [own, calls] = await Promise.all([
    prisma.testAttempt.findMany({
      where: { candidateId, status: { in: ['passed', 'not_confirmed'] }, finishedAt: { not: null } },
      select: { id: true, finishedAt: true, items: { where: { answer: { not: null } }, select: { templateId: true } } },
    }),
    prisma.callSession.findMany({
      where: { candidateId, kind: { in: ['qualifying', 'interview'] }, status: 'finished' },
      select: { startedAt: true, verdictJson: true },
    }),
  ]);
  const refs: AttemptRef[] = own.map((a) => ({ id: a.id, finishedAt: a.finishedAt, templateIds: new Set(a.items.map((i) => i.templateId)) }));
  const reviewed: OwnershipCall[] = calls.flatMap((c) => {
    const o = parseOwnership(c.verdictJson);
    return o ? [{ startedAt: c.startedAt, ...o }] : [];
  });
  if (ownershipForAttempt(sourceId, reviewed, refs) === 'explained') return null;
  return { attemptId: sourceId };
}
