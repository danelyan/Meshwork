// Контекст интервьюера: специализация, заявленный грейд, темы из утверждений профиля и факты резюме.
// Оценщику из этого уходят только названия тем (evaluator.ts).
import type { Specialization } from '../../lib/directions';
import { prisma } from '../db';
import { CALL_LIMITS, type TopicSeed } from './plan';
import type { Grade } from '../../lib/grades';

export interface CandidateCallContext {
  specialization: Specialization;
  claimedGrade: Grade | null;
  topics: TopicSeed[];
  /** Факты резюме (цитаты утверждений) — вырезаются из вопросов перед оценщиком. */
  resumeFacts: string[];
}

const LEVEL_PRIORITY: Record<string, number> = { self_reported: 0, artifact: 1, third_party: 2, platform: 3 };

function topicName(statement: string): string {
  const t = statement.replace(/\s+/g, ' ').trim();
  return t.length > 110 ? `${t.slice(0, 109)}…` : t;
}

function fact(quote: string): string | null {
  const t = quote.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return null;
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/**
 * Темы созвона: утверждения кандидата (не отклонённые) его специализации и общие, сначала ещё не
 * проверенные платформой и с большим весом. Утверждений мало — добивается ключевыми записями каталога
 * для специализации и грейда (claimed=false: тема от платформы).
 */
export async function loadCallContext(candidateId: string): Promise<CandidateCallContext> {
  const cand = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      specialization: true,
      profile: { select: { claimedGrade: true } },
      categories: { orderBy: { confirmedAt: 'desc' }, take: 1, select: { specialization: true, grade: true } },
    },
  });
  const specialization = cand?.categories[0]?.specialization ?? cand?.specialization ?? 'backend';
  const claimedGrade = cand?.profile?.claimedGrade ?? cand?.categories[0]?.grade ?? null;

  const claims = await prisma.claim.findMany({
    where: { candidateId, status: { not: 'rejected' }, catalog: { specialization: { in: [specialization, 'common'] } } },
    select: { catalogId: true, statement: true, quote: true, level: true, catalog: { select: { statement: true, weight: true } } },
  });
  claims.sort(
    (a, b) =>
      (LEVEL_PRIORITY[a.level] ?? 0) - (LEVEL_PRIORITY[b.level] ?? 0) || b.catalog.weight - a.catalog.weight || a.catalogId.localeCompare(b.catalogId),
  );
  const seen = new Set<string>();
  const topics: TopicSeed[] = [];
  for (const c of claims) {
    if (seen.has(c.catalogId)) continue;
    seen.add(c.catalogId);
    topics.push({ topic: topicName(c.catalog.statement), catalogId: c.catalogId, claimStatement: c.statement, resumeFact: fact(c.quote) });
    if (topics.length >= CALL_LIMITS.maxTopics) break;
  }
  if (topics.length < 3) {
    const grade = claimedGrade ?? 'junior';
    const extra = await prisma.claimCatalog.findMany({
      where: { specialization, grades: { has: grade }, id: { notIn: [...seen] } },
      orderBy: [{ weight: 'desc' }, { id: 'asc' }],
      take: 3 - topics.length,
      select: { id: true, statement: true },
    });
    for (const e of extra) topics.push({ topic: topicName(e.statement), catalogId: e.id, claimStatement: null, resumeFact: null });
  }
  const resumeFacts = claims.map((c) => c.quote.trim()).filter((q) => q.length >= 8);
  return { specialization, claimedGrade, topics, resumeFacts };
}
