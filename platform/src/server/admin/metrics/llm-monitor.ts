import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';

import { sinceFor } from './period';

/** Расходы и качество LLM из `AgentRun` по `purpose` и по дням (день – по Москве). Без ПДн: кандидаты – только id. */
export interface LlmPurposeRow {
  purpose: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** Доля невалидного JSON среди запросов со схемой; null – запросов со схемой не было. */
  invalidJsonShare: number | null;
  /** Сколько лишних попыток (attempts − 1) и доля неуспешных вызовов. */
  retries: number;
  failedShare: number | null;
}

export interface LlmDayRow {
  day: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface NearCeilingRow {
  candidateId: string;
  tokens: number;
  share: number;
}

/** Порог «у потолка»: доля суточного бюджета (скользящие 24 часа, как у `assertBudget`). */
export const NEAR_CEILING_SHARE = 0.8;

interface PRow {
  purpose: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  p50Ms: number | null;
  p95Ms: number | null;
  withSchema: number;
  invalid: number;
  retries: number;
  failed: number;
}

export async function llmByPurpose(days: number, now: Date = new Date()): Promise<LlmPurposeRow[]> {
  const since = sinceFor(days, now);
  const rows = await prisma.$queryRaw<PRow[]>(Prisma.sql`
    SELECT "purpose"::text AS purpose, count(*)::int AS runs,
           coalesce(sum("inputTokens"), 0)::int AS "inputTokens", coalesce(sum("outputTokens"), 0)::int AS "outputTokens",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS "p50Ms",
           percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95Ms",
           (count(*) FILTER (WHERE "jsonValid" IS NOT NULL))::int AS "withSchema",
           (count(*) FILTER (WHERE "jsonValid" IS FALSE))::int AS invalid,
           coalesce(sum(GREATEST("attempts" - 1, 0)), 0)::int AS retries,
           (count(*) FILTER (WHERE "ok" IS FALSE))::int AS failed
    FROM "AgentRun" WHERE "createdAt" >= ${since}
    GROUP BY "purpose" ORDER BY sum("inputTokens" + "outputTokens") DESC NULLS LAST`);
  return rows.map((r) => ({
    purpose: r.purpose,
    runs: r.runs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    p50Ms: r.p50Ms,
    p95Ms: r.p95Ms,
    invalidJsonShare: r.withSchema > 0 ? r.invalid / r.withSchema : null,
    retries: r.retries,
    failedShare: r.runs > 0 ? r.failed / r.runs : null,
  }));
}

export async function llmByDay(days: number, now: Date = new Date()): Promise<LlmDayRow[]> {
  const since = sinceFor(days, now);
  return prisma.$queryRaw<LlmDayRow[]>(Prisma.sql`
    SELECT to_char(("createdAt" AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS day, count(*)::int AS runs,
           coalesce(sum("inputTokens"), 0)::int AS "inputTokens", coalesce(sum("outputTokens"), 0)::int AS "outputTokens"
    FROM "AgentRun" WHERE "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1`);
}

/** Кандидаты, израсходовавшие ≥ 80 % суточного бюджета за скользящие 24 часа. Бюджет 0 – лимит выключен, список пуст. */
export async function nearCeiling(now: Date = new Date(), budget: number = getEnv().LLM_DAILY_TOKEN_BUDGET): Promise<NearCeilingRow[]> {
  if (budget <= 0) return [];
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const min = Math.ceil(budget * NEAR_CEILING_SHARE);
  const rows = await prisma.$queryRaw<{ candidateId: string; tokens: number }[]>(Prisma.sql`
    SELECT "candidateId", sum("inputTokens" + "outputTokens")::int AS tokens
    FROM "AgentRun" WHERE "candidateId" IS NOT NULL AND "createdAt" >= ${since}
    GROUP BY "candidateId" HAVING sum("inputTokens" + "outputTokens") >= ${min}
    ORDER BY tokens DESC LIMIT 50`);
  return rows.map((r) => ({ ...r, share: r.tokens / budget }));
}
