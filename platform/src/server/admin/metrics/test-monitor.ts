import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';

import { sinceFor } from './period';

/**
 * Монитор теста на грейд: по каждому заданию (шаблону) за период. Живые данные, не симулятор: расчёты на
 * экспертных параметрах – в `server/validation` и `eval:test`; здесь то, что видно на реальных попытках.
 * Агрегаты считает Postgres (corr, percentile_cont), в память идёт одна строка на шаблон.
 */

/** Правило «нужна перекалибровка» (показывается на странице как есть). */
export const RECALIBRATION_RULES = {
  /** Меньше ответов – выводов не делаем. */
  minAnswered: 30,
  /** Верных почти всегда или почти никогда: задание ничего не различает. */
  tooEasy: 0.95,
  tooHard: 0.05,
  /** Корреляция «верно ↔ итоговая θ» ниже порога – задание плохо отделяет сильных от слабых. */
  minCorrelation: 0.1,
  /** Минимум пар (ответ, θ попытки), чтобы корреляции верить. */
  minPairs: 20,
  /** Заданная сложность irtB (шкала θ) и доля верных расходятся: ожидаемая доля при θ=0 – logistic(a·(0−b)). */
  maxGapFromModel: 0.3,
} as const;

export interface TestItemStat {
  templateId: string;
  title: string;
  specialization: string;
  grade: string;
  paramsSource: string;
  irtA: number;
  irtB: number;
  /** Сколько раз показано / отвечено в периоде. */
  shown: number;
  answered: number;
  correctShare: number | null;
  /** Корреляция Пирсона (верно 0/1, θ попытки) = точечно-бисериальная; null, если мало пар или нет разброса. */
  discrimination: number | null;
  pairs: number;
  medianSec: number | null;
  avgSec: number | null;
  flags: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Чистая функция правила: причины, по которым заданию нужна перекалибровка. Пусто – всё в порядке или мало данных. */
export function recalibrationFlags(s: Pick<TestItemStat, 'answered' | 'correctShare' | 'discrimination' | 'pairs' | 'irtA' | 'irtB'>): string[] {
  const R = RECALIBRATION_RULES;
  if (s.answered < R.minAnswered || s.correctShare === null) return [];
  const out: string[] = [];
  if (s.correctShare >= R.tooEasy) out.push(`слишком лёгкое: верных ${pct(s.correctShare)}`);
  if (s.correctShare <= R.tooHard) out.push(`слишком трудное: верных ${pct(s.correctShare)}`);
  if (s.pairs >= R.minPairs && s.discrimination !== null && s.discrimination < R.minCorrelation) {
    out.push(`слабо различает: корреляция ${s.discrimination.toFixed(2)} < ${R.minCorrelation}`);
  }
  const expected = 1 / (1 + Math.exp(-s.irtA * (0 - s.irtB)));
  if (Math.abs(expected - s.correctShare) > R.maxGapFromModel) {
    out.push(`доля верных ${pct(s.correctShare)} далека от модели (${pct(expected)} при θ=0)`);
  }
  return out;
}

interface Row {
  templateId: string;
  title: string;
  specialization: string;
  grade: string;
  paramsSource: string;
  irtA: number;
  irtB: number;
  shown: number;
  answered: number;
  correct: number;
  pairs: number;
  corr: number | null;
  medianSec: number | null;
  avgSec: number | null;
}

export async function testItemStats(days: number, now: Date = new Date()): Promise<TestItemStat[]> {
  const since = sinceFor(days, now);
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT t."id" AS "templateId", t."title", t."specialization"::text AS "specialization", t."grade"::text AS "grade",
           t."paramsSource", t."irtA", t."irtB",
           count(*)::int AS "shown",
           (count(i."answeredAt"))::int AS "answered",
           (count(*) FILTER (WHERE i."correct" IS TRUE))::int AS "correct",
           (count(*) FILTER (WHERE i."correct" IS NOT NULL AND a."theta" IS NOT NULL))::int AS "pairs",
           corr((CASE WHEN i."correct" THEN 1.0 ELSE 0.0 END), a."theta") FILTER (WHERE i."correct" IS NOT NULL AND a."theta" IS NOT NULL) AS "corr",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i."answeredAt" - i."askedAt")))
             FILTER (WHERE i."answeredAt" IS NOT NULL) AS "medianSec",
           avg(EXTRACT(EPOCH FROM (i."answeredAt" - i."askedAt"))) FILTER (WHERE i."answeredAt" IS NOT NULL) AS "avgSec"
    FROM "TestItem" i
    JOIN "TestAttempt" a ON a."id" = i."attemptId" AND a."mode" = 'full'
    JOIN "TaskTemplate" t ON t."id" = i."templateId"
    WHERE i."askedAt" >= ${since}
    GROUP BY t."id"
    ORDER BY count(*) DESC, t."id"`);
  return rows.map((r) => {
    const base = {
      templateId: r.templateId,
      title: r.title,
      specialization: r.specialization,
      grade: r.grade,
      paramsSource: r.paramsSource,
      irtA: r.irtA,
      irtB: r.irtB,
      shown: r.shown,
      answered: r.answered,
      correctShare: r.answered > 0 ? r.correct / r.answered : null,
      discrimination: r.corr === null || Number.isNaN(r.corr) ? null : r.corr,
      pairs: r.pairs,
      medianSec: r.medianSec,
      avgSec: r.avgSec,
    };
    return { ...base, flags: recalibrationFlags(base) };
  });
}
