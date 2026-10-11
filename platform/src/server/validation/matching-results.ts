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

/** Калибровка балла (eval/matching/calibration.ts): кривая «до», метрики до/после, кросс-проверка по половинам вакансий. Блок необязательный. */
const CalibMetrics = z.object({ n: z.number(), positives: z.number(), brier: z.number(), logLoss: z.number(), ece: z.number() });
const CalibBin = z.object({ lo: z.number(), hi: z.number(), n: z.number(), meanScore: z.number().nullable(), share: z.number().nullable() });
const CalibBlock = z.object({
  pairs: z.number(),
  positives: z.number(),
  base: z.number(),
  before: CalibMetrics,
  afterInSample: CalibMetrics,
  curveBefore: z.array(CalibBin),
  curveAfter: z.array(CalibBin),
  holdout: z.object({ brierBefore: z.number(), brierAfter: z.number() }),
});
const Calibration = z.object({ note: z.string(), profiles: z.number(), vacancies: z.number(), pairsShown: z.number(), relevant: CalibBlock, strong: CalibBlock });
export type MatchingCalibration = z.infer<typeof Calibration>;

const parseCalibration = (v: unknown): MatchingCalibration | null => {
  const r = Calibration.safeParse(v);
  return v !== undefined && r.success ? r.data : null;
};

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
  /** Калибровка балла в вероятность на синтетической разметке (если есть в results.json). */
  calibration: MatchingCalibration | null;
}

const optional = (v: unknown): MatchingExtended | null => {
  const r = Extended.safeParse(v);
  return v !== undefined && r.success ? r.data : null;
};

const parseAblation = (v: unknown): MatchingAblation | null => {
  const r = Ablation.safeParse(v);
  return v !== undefined && r.success ? r.data : null;
};

/** Разбор results.json; обязательная часть не сошлась — исключение (тест это ловит до стенда). */
export function parseMatchingResults(json: unknown): MatchingResults {
  const base = z.object({ summary: Summary, rows: z.array(Row) }).parse(json);
  const o = json as Record<string, unknown>;
  return { summary: base.summary, rows: base.rows, extended: optional(o.extended), legacyExtended: optional(o.legacyExtended), ablation: parseAblation(o.ablation), calibration: parseCalibration(o.calibration) };
}

export function matchingResults(): MatchingResults {
  return parseMatchingResults(raw as unknown);
}
