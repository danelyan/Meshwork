import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';

import { sinceFor } from './period';

/**
 * Монитор подбора: воронка приглашений по категориям (специализация × грейд кандидата — его последняя категория).
 * «Принято» = accepted + hired (найм возможен только из accepted); отозванные и закрытые наймом остаются в «отправлено».
 * Время до первого приглашения — от выдачи категории (`CandidateCategory.confirmedAt`) до первого приглашения
 * кандидату в периоде, медиана по кандидатам категории.
 */
export interface FunnelRow {
  specialization: string;
  grade: string;
  sent: number;
  viewed: number;
  accepted: number;
  declined: number;
  acceptedShare: number | null;
  /** Кандидатов с приглашением в периоде и медиана часов от категории до первого приглашения. */
  invitedCandidates: number;
  medianHoursToFirst: number | null;
}

interface Row {
  specialization: string;
  grade: string;
  sent: number;
  viewed: number;
  accepted: number;
  declined: number;
  invitedCandidates: number;
  medianHoursToFirst: number | null;
}

export async function matchingFunnel(days: number, now: Date = new Date()): Promise<FunnelRow[]> {
  const since = sinceFor(days, now);
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH cat AS (
      SELECT DISTINCT ON ("candidateId") "candidateId", "specialization"::text AS spec, "grade"::text AS grade, "confirmedAt"
      FROM "CandidateCategory" ORDER BY "candidateId", "confirmedAt" DESC
    ), inv AS (
      SELECT i.*, c.spec, c.grade, c."confirmedAt" AS cat_at
      FROM "Invitation" i JOIN cat c ON c."candidateId" = i."candidateId"
      WHERE i."createdAt" >= ${since}
    ), first_inv AS (
      SELECT "candidateId", spec, grade, min("createdAt") AS first_at, max(cat_at) AS cat_at FROM inv GROUP BY 1, 2, 3
    ), funnel AS (
      SELECT spec, grade, count(*)::int AS sent,
             (count(*) FILTER (WHERE "viewedAt" IS NOT NULL))::int AS viewed,
             (count(*) FILTER (WHERE "status" IN ('accepted', 'hired')))::int AS accepted,
             (count(*) FILTER (WHERE "status" = 'declined'))::int AS declined
      FROM inv GROUP BY 1, 2
    ), ttf AS (
      SELECT spec, grade, count(*)::int AS invited,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (first_at - cat_at)) / 3600.0, 0)) AS med
      FROM first_inv GROUP BY 1, 2
    )
    SELECT f.spec AS "specialization", f.grade, f.sent, f.viewed, f.accepted, f.declined,
           t.invited AS "invitedCandidates", t.med AS "medianHoursToFirst"
    FROM funnel f JOIN ttf t USING (spec, grade)
    ORDER BY f.sent DESC, f.spec, f.grade`);
  return rows.map((r) => ({ ...r, acceptedShare: r.sent > 0 ? r.accepted / r.sent : null }));
}
