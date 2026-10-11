import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';

import { objectionDeadline } from './cards';
import { DAY_MS } from './lib';

/**
 * Дашборд `/admin` (E-08, фаза 1). Только сводные счётчики; подробные метрики качества и расход LLM по
 * `purpose` — фаза 5 (`/admin/metrics`). Агрегация в БД, строки не вытягиваются. Время дней — МСК.
 */

export const DASHBOARD_DAYS = 14;

export async function loadDashboard(now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const since = new Date(now.getTime() - DASHBOARD_DAYS * DAY_MS);
  const [roles, perDay, categories, fsp, candidatesTotal, companies, verified, blocked, funnelRows, viewed, openComplaints, oldestComplaint, openObjections, openObjectionsTotal, llm] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.$queryRaw<{ day: string; role: string; n: bigint }[]>(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS day, role::text AS role, count(*) AS n
      FROM "User" WHERE "createdAt" >= ${since} GROUP BY 1, 2 ORDER BY 1`),
    // Текущая категория кандидата — последняя подтверждённая.
    prisma.$queryRaw<{ specialization: string; grade: string; n: bigint }[]>(Prisma.sql`
      SELECT specialization::text AS specialization, grade::text AS grade, count(*) AS n FROM (
        SELECT DISTINCT ON ("candidateId") "candidateId", specialization, grade FROM "CandidateCategory" ORDER BY "candidateId", "confirmedAt" DESC
      ) t GROUP BY 1, 2 ORDER BY 1, 2`),
    prisma.candidate.groupBy({ by: ['fspState'], _count: { _all: true } }),
    prisma.candidate.count(),
    prisma.company.count(),
    prisma.company.count({ where: { verifiedAt: { not: null } } }),
    prisma.company.count({ where: { blockedAt: { not: null } } }),
    prisma.invitation.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.invitation.count({ where: { viewedAt: { not: null } } }),
    prisma.complaint.count({ where: { status: 'open' } }),
    prisma.complaint.findFirst({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.assessmentObjection.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true, subject: true, createdAt: true } }),
    prisma.assessmentObjection.count({ where: { status: 'open' } }),
    prisma.agentRun.aggregate({ where: { createdAt: { gte: dayAgo } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } }),
  ]);

  const sc = (s: string) => funnelRows.find((r) => r.status === s)?._count._all ?? 0;
  const sent = funnelRows.reduce((s, r) => s + r._count._all, 0);
  const accepted = sc('accepted') + sc('hired');
  // «Нет истории ФСП» (R-FSP-03): не привязан, недоступен или без достижений — всё, кроме linked.
  const withoutFsp = fsp.filter((r) => r.fspState !== 'linked').reduce((s, r) => s + r._count._all, 0);

  return {
    generatedAt: now,
    users: {
      byRole: Object.fromEntries(roles.map((r) => [r.role, r._count._all])) as Record<string, number>,
      total: roles.reduce((s, r) => s + r._count._all, 0),
      perDay: perDay.map((r) => ({ day: r.day, role: r.role, count: Number(r.n) })),
      days: DASHBOARD_DAYS,
    },
    candidates: {
      total: candidatesTotal,
      categorized: categories.reduce((s, r) => s + Number(r.n), 0),
      byCategory: categories.map((r) => ({ specialization: r.specialization, grade: r.grade, count: Number(r.n) })),
      withoutFspHistory: withoutFsp,
      withoutFspShare: candidatesTotal > 0 ? withoutFsp / candidatesTotal : null,
    },
    companies: { total: companies, verified, blocked },
    funnel: { sent, viewed, accepted, declined: sc('declined'), hired: sc('hired'), withdrawn: sc('withdrawn') + sc('closed_hired') },
    moderation: {
      openComplaints,
      oldestComplaintHours: oldestComplaint ? Math.floor((now.getTime() - oldestComplaint.createdAt.getTime()) / 3_600_000) : null,
      openObjectionsTotal,
      openObjections: openObjections.map((o) => ({ id: o.id, subject: o.subject, createdAt: o.createdAt, hoursLeft: Math.floor((objectionDeadline(o.createdAt).getTime() - now.getTime()) / 3_600_000) })),
    },
    llm24h: { calls: llm._count._all, tokens: (llm._sum.inputTokens ?? 0) + (llm._sum.outputTokens ?? 0) },
  };
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
