// «Длина теста и надёжность» для /validation: перебор лимитов длины (eval/test/length-sweep.ts → results.json.lengthSweep)
// и ширина банка по подкатегориям (eval/test/bank-width.ts → results.json.bankWidth). Чистый разбор, без БД.

export interface SweepSetting {
  /** Ретест: κ Коэна по бинарному решению (среднее по подкатегориям). */
  kappa: number | null;
  kappaMin: number | null;
  agreement: number | null;
  lengthMean: number | null;
  earlyStopShare: number | null;
  falsePass: number | null;
  minutesMean: number | null;
}

export interface LengthSweepVariant {
  min: number;
  max: number;
  /** Текущие дефолты policy.ts (MIN_ITEMS…MAX_ITEMS). */
  current: boolean;
  strict: SweepSetting;
  competitor: SweepSetting;
}

export interface LengthSweep {
  generatedAt: string;
  command: string;
  config: { n: number; seed: number; errorModel: string };
  variants: LengthSweepVariant[];
}

export interface BankWidthRow {
  subcategoryId: string;
  title: string;
  /** Свои семейства подкатегории по грейду. */
  own: { junior: number; middle: number; senior: number };
  /** Общие семейства (common-map) — в пул попытки идут с долей ≤ 30 %. */
  common: number;
  /** Сколько заданий достижимо в одной попытке Junior/Middle без повторов (reachableSize). */
  reachable: number;
  /** Для каждого max варианта: сколько не хватает до max + дозадавание (0 — хватает). */
  shortBy: Record<string, number>;
  /** Для каждого max: сколько не хватает на две попытки без общих семейств (ретест без повторов). */
  shortByRetest: Record<string, number>;
}

export interface BankWidth {
  generatedAt: string;
  command: string;
  /** Длины, для которых считана нехватка (max варианта). */
  maxes: number[];
  probe: number;
  rows: BankWidthRow[];
}

type Summary = Record<string, { mean: number | null; min: number | null; max: number | null } | undefined>;

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Строка варианта из JSON одного прогона run.ts (summary.instance). Нет summary.instance — исключение. */
export function parseLengthSweepRun(run: unknown, v: { min: number; max: number; current: boolean }): LengthSweepVariant {
  const summary = (run as { summary?: Record<string, Summary> })?.summary?.instance;
  if (!summary) throw new Error('run.ts JSON: нет summary.instance (нужен --error instance)');
  const pick = (setting: 'strict' | 'competitor'): SweepSetting => {
    const m = (key: string) => num(summary[`${setting}.${key}`]?.mean);
    return {
      kappa: m('retest.kappaBinary'),
      kappaMin: num(summary[`${setting}.retest.kappaBinary`]?.min),
      agreement: m('retest.decisionAgreement'),
      lengthMean: m('length.mean'),
      earlyStopShare: m('earlyStopShare'),
      falsePass: m('falsePass'),
      minutesMean: m('minutes.mean'),
    };
  };
  return { ...v, strict: pick('strict'), competitor: pick('competitor') };
}

/**
 * Разбор results.json для блока /validation: lengthSweep и bankWidth необязательны (null — блок не показывается),
 * но если ключ есть и не сходится по форме — исключение (тест ловит до стенда).
 */
export function parseLengthBlock(raw: unknown): { sweep: LengthSweep | null; bank: BankWidth | null } {
  const r = raw as { lengthSweep?: unknown; bankWidth?: unknown };
  let sweep: LengthSweep | null = null;
  let bank: BankWidth | null = null;
  if (r.lengthSweep !== undefined) {
    const s = r.lengthSweep as LengthSweep;
    if (!Array.isArray(s.variants) || s.variants.some((v) => typeof v.min !== 'number' || typeof v.max !== 'number' || !v.strict || !v.competitor)) {
      throw new Error('results.json: lengthSweep.variants не той формы');
    }
    sweep = s;
  }
  if (r.bankWidth !== undefined) {
    const b = r.bankWidth as BankWidth;
    if (!Array.isArray(b.rows) || !Array.isArray(b.maxes) || b.rows.some((x) => typeof x.reachable !== 'number' || !x.own || !x.shortBy)) {
      throw new Error('results.json: bankWidth не той формы');
    }
    bank = b;
  }
  return { sweep, bank };
}

/**
 * Правило выбора дефолта (задача 11.10): вариант с κ (строгая) ≥ kappaTarget при средней длине ≤ maxMeanLength,
 * для которого банк позволяет max без нехватки во всех подкатегориях. Из подходящих — самый короткий. null — нет такого.
 */
export function pickDefaultLimits(
  sweep: LengthSweep,
  bank: BankWidth | null,
  opts: { kappaTarget?: number; maxMeanLength?: number } = {},
): LengthSweepVariant | null {
  const target = opts.kappaTarget ?? 0.47;
  const maxLen = opts.maxMeanLength ?? 12;
  const ok = sweep.variants.filter((v) => {
    if (v.strict.kappa === null || v.strict.kappa < target) return false;
    if (v.strict.lengthMean === null || v.strict.lengthMean > maxLen) return false;
    if (!bank) return false;
    return bank.rows.every((row) => (row.shortBy[String(v.max)] ?? Infinity) === 0);
  });
  ok.sort((a, b) => (a.strict.lengthMean ?? 0) - (b.strict.lengthMean ?? 0));
  return ok[0] ?? null;
}
