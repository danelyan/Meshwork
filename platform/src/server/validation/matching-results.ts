// Цифры подбора для /validation — из закоммиченного eval/matching/results.json (пишет eval/matching/run.ts).
// JSON попадает в серверный бандл при сборке: страница показывает ровно то, что лежит в репозитории.
// Старые поля обязательны, новые (расширенный набор, BM25, бутстреп-интервалы) — по возможности:
// не разобрался блок — блок не показываем, страница не падает.
import { z } from 'zod';

import raw from '../../../eval/matching/results.json';

const Summary = z.object({
  k: z.number(),
  profiles: z.number(),
  vacancies: z.number(),
  precisionAt5: z.number(),
  precisionAt5Ceiling: z.number(),
  ndcgAt5: z.number(),
  baseline: z.object({ precisionAt5: z.number(), ndcgAt5: z.number() }),
});

const Row = z.object({
  vacancy: z.string(),
  p: z.number(),
  pMax: z.number(),
  ndcg: z.number(),
  bP: z.number(),
  bNdcg: z.number(),
});

const MethodMetrics = z.object({
  p5: z.number().optional(),
  p10: z.number().optional(),
  ndcg10: z.number().optional(),
  recall50: z.number().nullish(),
  mrr: z.number().optional(),
});
const Interval = z.object({ mean: z.number(), lo: z.number(), hi: z.number() });

/** Расширенный прогон (лейн match-eval): методы, разница с бутстреп-интервалом. Все поля необязательны. */
const Extended = z.object({
  vacancies: z.number().optional(),
  profiles: z.number().optional(),
  methods: z.record(z.string(), MethodMetrics).optional(),
  deltaOursMinusBm25: z.record(z.string(), Interval).optional(),
  deltaOursMinusBaselineClaims: z.record(z.string(), Interval).optional(),
});

/** Абляция (eval/matching/ablation.ts): строка «без сигнала X». Блок необязательный. */
const AblationRow = z.object({
  signal: z.string(),
  label: z.string(),
  p5: Interval,
  ndcg10: Interval,
  dP5: Interval.nullable(),
  dNdcg10: Interval.nullable(),
  measured: z.boolean(),
});
const Ablation = z.object({ note: z.string().optional(), profiles: z.number(), vacancies: z.number(), rows: z.array(AblationRow) });
export type MatchingAblation = z.infer<typeof Ablation>;

/** Слепая разметка (eval/matching/blind-eval.ts): два ИИ-размечающих, κ, методы по разметкам. Блок необязательный. */
const BlindMetric = z.object({ p5: Interval, p5strict: Interval.optional(), ndcg10: Interval });
const BlindSet = z.object({
  methods: z.record(z.string(), BlindMetric),
  deltaOursMinusBm25: BlindMetric,
  deltaOursMinusBaselineClaims: BlindMetric.optional(),
});
const Blind = z.object({
  note: z.string().optional(),
  vacancies: z.number(),
  pool: z.number(),
  pairs: z.number(),
  labelers: z.object({ a: z.string(), b: z.string() }),
  kappa: z.object({ ab: z.number(), aVsGenerator: z.number(), bVsGenerator: z.number(), consensusVsGenerator: z.number().optional() }),
  exactAgreementAB: z.number().optional(),
  coverageTop10: z.record(z.string(), z.number()).optional(),
  sets: z.object({ a: BlindSet, b: BlindSet, consensus: BlindSet, generator: BlindSet.optional() }),
});
export type MatchingBlind = z.infer<typeof Blind>;

export type MatchingSummary = z.infer<typeof Summary>;
export type MatchingRow = z.infer<typeof Row>;
export type MatchingExtended = z.infer<typeof Extended>;
export interface MatchingResults {
  summary: MatchingSummary;
  rows: MatchingRow[];
  /** Синтетика побольше (если есть в results.json). */
  extended: MatchingExtended | null;
  /** Тот же демо-набор, но с BM25, интервалами и случайной линией (если есть). */
  legacyExtended: MatchingExtended | null;
  /** Абляция сигналов формулы (если есть в results.json). */
  ablation: MatchingAblation | null;
  /** Независимая слепая разметка (если есть в results.json). */
  blind: MatchingBlind | null;
}

const optional = (v: unknown): MatchingExtended | null => {
  const r = Extended.safeParse(v);
  return v !== undefined && r.success ? r.data : null;
};

const parseAblation = (v: unknown): MatchingAblation | null => {
  const r = Ablation.safeParse(v);
  return v !== undefined && r.success ? r.data : null;
};

const parseBlind = (v: unknown): MatchingBlind | null => {
  const r = Blind.safeParse(v);
  return v !== undefined && r.success ? r.data : null;
};

/** Разбор results.json; обязательная часть не сошлась — исключение (тест это ловит до стенда). */
export function parseMatchingResults(json: unknown): MatchingResults {
  const base = z.object({ summary: Summary, rows: z.array(Row) }).parse(json);
  const o = json as Record<string, unknown>;
  return { summary: base.summary, rows: base.rows, extended: optional(o.extended), legacyExtended: optional(o.legacyExtended), ablation: parseAblation(o.ablation), blind: parseBlind(o.blind) };
}

export function matchingResults(): MatchingResults {
  return parseMatchingResults(raw as unknown);
}
