// Метрики валидации ступеней 1 (квалифицирующий созвон) и 3 (защита проекта) ADR 0003.
// Чистые функции без БД и LLM: их проверяет tests/unit/eval/stage-metrics.test.ts, а скрипты
// eval/call/personas.ts и eval/defense/personas.ts только собирают наблюдения.
import { decidePassed } from '../../src/server/defense/evaluator';
import type { DefenseScores } from '../../src/server/defense/types';

// ---------------------------------------------------------------------------
// Счётчик вызовов LLM
// ---------------------------------------------------------------------------
export interface PurposeUsage {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}

export interface MeterSnapshot {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  byPurpose: Record<string, PurposeUsage>;
}

export function emptyMeter(): MeterSnapshot {
  return { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, byPurpose: {} };
}

export function addUsage(m: MeterSnapshot, purpose: string, u: { inputTokens: number; outputTokens: number } | null): void {
  const p = (m.byPurpose[purpose] ??= { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 });
  m.calls++;
  p.calls++;
  if (!u) {
    m.failures++;
    p.failures++;
    return;
  }
  m.inputTokens += u.inputTokens;
  m.outputTokens += u.outputTokens;
  p.inputTokens += u.inputTokens;
  p.outputTokens += u.outputTokens;
}

/** Разница двух снимков счётчика (after − before): расход одного созвона или одной защиты. */
export function diffMeter(after: MeterSnapshot, before: MeterSnapshot): MeterSnapshot {
  const out = emptyMeter();
  out.calls = after.calls - before.calls;
  out.failures = after.failures - before.failures;
  out.inputTokens = after.inputTokens - before.inputTokens;
  out.outputTokens = after.outputTokens - before.outputTokens;
  for (const [k, a] of Object.entries(after.byPurpose)) {
    const b = before.byPurpose[k] ?? { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
    const d = { calls: a.calls - b.calls, failures: a.failures - b.failures, inputTokens: a.inputTokens - b.inputTokens, outputTokens: a.outputTokens - b.outputTokens };
    if (d.calls > 0) out.byPurpose[k] = d;
  }
  return out;
}

export function sumMeters(list: readonly MeterSnapshot[]): MeterSnapshot {
  const out = emptyMeter();
  for (const m of list) {
    out.calls += m.calls;
    out.failures += m.failures;
    out.inputTokens += m.inputTokens;
    out.outputTokens += m.outputTokens;
    for (const [k, v] of Object.entries(m.byPurpose)) {
      const p = (out.byPurpose[k] ??= { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 });
      p.calls += v.calls;
      p.failures += v.failures;
      p.inputTokens += v.inputTokens;
      p.outputTokens += v.outputTokens;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Общие статистики
// ---------------------------------------------------------------------------
export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export function spread(xs: readonly number[]): number {
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
}

/**
 * Разведение двух групп: вероятность, что случайный балл группы a выше случайного балла группы b
 * (ничья – половина). 1 – разведены полностью, 0,5 – не различаются. Это AUC Манна – Уитни.
 */
export function separation(a: readonly number[], b: readonly number[]): number | null {
  if (!a.length || !b.length) return null;
  let s = 0;
  for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0;
  return s / (a.length * b.length);
}

const r2 = (x: number | null): number | null => (x === null ? null : Math.round(x * 100) / 100);

// ---------------------------------------------------------------------------
// Ступень 1: квалифицирующий созвон
// ---------------------------------------------------------------------------
export interface CallTopicObs {
  topic: string;
  catalogId: string | null;
  /** Ожидание по легенде персоны: тема должна подтвердиться (true) / не должна (false) / не задано (null). */
  expected: boolean | null;
  confirmed: boolean;
  /** Статус темы (после 10.10): confirmed / not_confirmed / inconclusive / not_probed. */
  status?: string;
  /** По теме задавали дополнительный вопрос (расхождение оценщика). */
  extraProbe?: boolean;
  /** Сумма медиан по четырём признакам A-02 (0–8). */
  total: number;
  probed: number;
  maxLevel: number;
  /** Баллы каждого прогона оценщика по этой теме. */
  runs: DefenseScores[];
}

export interface CallObs {
  persona: string;
  call: number;
  sessionId: string;
  questions: number;
  /** Вопросы из шаблона (модель интервьюера не ответила валидно). */
  fallbackQuestions: number;
  /** Вопросы, где интервьюер пересказал профиль (общая n-грамма ≥ 4 слов с утверждением/резюме). */
  retoldQuestions?: number;
  /** Дополнительные вопросы по неопределённым темам. */
  probeQuestions?: number;
  /** Прогонов оценщика всего (3, 5, с досчётом – больше). */
  evaluatorRuns?: number;
  validRuns: number;
  topics: CallTopicObs[];
  platform: MeterSnapshot;
  persona_llm: MeterSnapshot;
  error?: string;
}

export interface CallTopicSummary {
  catalogId: string;
  topic: string;
  expected: boolean | null;
  /** По созвонам: true/false – подтверждено/нет, 'inconclusive' – не определено, null – тему не спросили. */
  got: (boolean | 'inconclusive' | null)[];
  totals: (number | null)[];
}

export interface CallPersonaSummary {
  persona: string;
  calls: number;
  failedCalls: number;
  /** Доля подтверждённых тем среди всех оценённых (по всем созвонам). */
  confirmedShare: number | null;
  /** Совпадение «подтверждено» с ожиданием по легенде, среди спрошенных тем с ожиданием. */
  matchRate: number | null;
  matched: number;
  judged: number;
  /** Доля пар (созвон × заявленная тема), где тему вообще спросили. */
  coverage: number | null;
  /** Тем со статусом «не определено» (из всех спрошенных). */
  inconclusive: number;
  /** Ошибок решения среди спрошенных тем с ожиданием: ✓ при «нет» или ✗ при «да» (не определено – не ошибка). */
  wrongDecisions: number;
  /** Пересказов профиля в вопросах (всего) и дополнительных вопросов (среднее на созвон). */
  retoldQuestions: number;
  avgProbeQuestions: number | null;
  avgEvaluatorRuns: number | null;
  topics: CallTopicSummary[];
  /** Повторяемость оценщика на одном транскрипте: разброс суммы между прогонами по теме. */
  withinSpreadMean: number | null;
  withinSpreadMax: number;
  /** Доля тем, где все прогоны дали одинаковое решение порога. */
  withinPassAgreement: number | null;
  /** Между созвонами: доля тем (спрошенных ≥ 2 раз), где решение одинаковое во всех созвонах. */
  betweenAgreement: number | null;
  /** Между созвонами: средний разброс суммы медиан по теме. */
  betweenSpreadMean: number | null;
  /** Среднее на созвон. */
  avgQuestions: number | null;
  avgPlatformCalls: number | null;
  avgPersonaCalls: number | null;
  avgPlatformTokens: number | null;
  fallbackQuestions: number;
}

export function totalOf(s: DefenseScores): number {
  return s.depth + s.why + s.boundary + s.completion;
}

export function summarizeCallPersona(persona: string, expected: Record<string, boolean>, calls: readonly CallObs[]): CallPersonaSummary {
  const ok = calls.filter((c) => !c.error);
  // Неспрошенные темы (status=not_probed) в карте есть, но в оценку и покрытие не входят.
  const probedOf = (c: CallObs) => c.topics.filter((t) => t.status !== 'not_probed');
  const all = ok.flatMap(probedOf);
  const judgedTopics = all.filter((t) => t.expected !== null);
  const matched = judgedTopics.filter((t) => t.status !== 'inconclusive' && t.confirmed === t.expected).length;
  const wrongDecisions = judgedTopics.filter((t) => t.status !== 'inconclusive' && t.confirmed !== t.expected).length;

  const ids = [...new Set([...Object.keys(expected), ...all.map((t) => t.catalogId ?? t.topic)])];
  const topics: CallTopicSummary[] = ids.map((id) => {
    const per = ok.map((c) => probedOf(c).find((t) => (t.catalogId ?? t.topic) === id) ?? null);
    const first = per.find(Boolean);
    return {
      catalogId: id,
      topic: first?.topic ?? id,
      expected: id in expected ? expected[id]! : null,
      got: per.map((t) => (t ? (t.status === 'inconclusive' ? ('inconclusive' as const) : t.confirmed) : null)),
      totals: per.map((t) => (t ? t.total : null)),
    };
  });
  const expectedIds = Object.keys(expected);
  const coveragePairs = ok.length * expectedIds.length;
  const covered = ok.reduce((s, c) => s + expectedIds.filter((id) => probedOf(c).some((t) => t.catalogId === id)).length, 0);

  const within = all.filter((t) => t.runs.length > 1);
  const withinSpreads = within.map((t) => spread(t.runs.map(totalOf)));
  const passAgree = within.filter((t) => new Set(t.runs.map((r) => decidePassed(r))).size === 1).length;

  const repeated = topics.filter((t) => t.got.filter((g) => g !== null).length >= 2);
  const betweenAgree = repeated.filter((t) => new Set(t.got.filter((g) => g !== null)).size === 1).length;
  const betweenSpreads = repeated.map((t) => spread(t.totals.filter((x): x is number => x !== null)));

  return {
    persona,
    calls: calls.length,
    failedCalls: calls.length - ok.length,
    confirmedShare: all.length ? all.filter((t) => t.confirmed).length / all.length : null,
    matchRate: judgedTopics.length ? matched / judgedTopics.length : null,
    matched,
    judged: judgedTopics.length,
    coverage: coveragePairs ? covered / coveragePairs : null,
    inconclusive: all.filter((t) => t.status === 'inconclusive').length,
    wrongDecisions,
    retoldQuestions: ok.reduce((s, c) => s + (c.retoldQuestions ?? 0), 0),
    avgProbeQuestions: mean(ok.map((c) => c.probeQuestions ?? 0)),
    avgEvaluatorRuns: mean(ok.map((c) => c.evaluatorRuns ?? 3)),
    topics,
    withinSpreadMean: mean(withinSpreads),
    withinSpreadMax: withinSpreads.length ? Math.max(...withinSpreads) : 0,
    withinPassAgreement: within.length ? passAgree / within.length : null,
    betweenAgreement: repeated.length ? betweenAgree / repeated.length : null,
    betweenSpreadMean: mean(betweenSpreads),
    avgQuestions: mean(ok.map((c) => c.questions)),
    avgPlatformCalls: mean(ok.map((c) => c.platform.calls)),
    avgPersonaCalls: mean(ok.map((c) => c.persona_llm.calls)),
    avgPlatformTokens: mean(ok.map((c) => c.platform.inputTokens + c.platform.outputTokens)),
    fallbackQuestions: ok.reduce((s, c) => s + c.fallbackQuestions, 0),
  };
}

// ---------------------------------------------------------------------------
// Ступень 3: защита проекта
// ---------------------------------------------------------------------------
export interface DefenseObs {
  persona: string;
  defense: number;
  sessionId: string;
  /** Общий балл (0–8): после 10.10 – среднее по вопросам с одним знаком; до – медиана по транскрипту. */
  total: number | null;
  passed: boolean | null;
  /** Баллы по вопросам (после 10.10). */
  items?: { itemId: string; label: string; ref: string | null; total: number; passed: boolean; runs: number[] }[];
  /** Суммы каждого прогона оценщика. */
  runs: number[];
  flags: string[];
  answered: number;
  followUps: number;
  generator: string;
  projectScore: number | null;
  platform: MeterSnapshot;
  persona_llm: MeterSnapshot;
  error?: string;
}

export interface DefensePersonaSummary {
  persona: string;
  defenses: number;
  failed: number;
  totals: number[];
  meanTotal: number | null;
  passRate: number | null;
  /** Доля защит с флагом strong_project_weak_defense. */
  flagRate: number | null;
  /** Доля защит с флагом uneven_understanding. */
  unevenRate: number | null;
  /** Средний балл вопросов по «своим» файлам персоны и по остальным (персона (c)). */
  knownItemMean: number | null;
  unknownItemMean: number | null;
  /** Средний разброс суммы вопроса между прогонами; прогонов на защиту. */
  itemSpreadMean: number | null;
  avgEvaluatorRuns: number | null;
  /** Разброс сумм между тремя прогонами одного транскрипта: среднее и максимум. */
  withinSpreadMean: number | null;
  withinSpreadMax: number;
  /** Разброс медианной суммы между защитами одной персоны. */
  betweenSpread: number;
  disagreementFlags: number;
  avgAnswered: number | null;
  avgPlatformCalls: number | null;
  avgPersonaCalls: number | null;
  avgPlatformTokens: number | null;
  qlcGenerators: Record<string, number>;
}

export const FLAG_STRONG_WEAK = 'strong_project_weak_defense';

export function summarizeDefensePersona(persona: string, list: readonly DefenseObs[], knownFiles: readonly string[] = []): DefensePersonaSummary {
  const ok = list.filter((d) => !d.error && d.total !== null);
  const items = ok.flatMap((d) => d.items ?? []);
  const isKnown = (ref: string | null) => !!ref && knownFiles.some((f) => ref.startsWith(f));
  const withRef = items.filter((i) => i.ref);
  const totals = ok.map((d) => d.total as number);
  const within = ok.filter((d) => d.runs.length > 1).map((d) => spread(d.runs));
  const gens: Record<string, number> = {};
  for (const d of ok) gens[d.generator] = (gens[d.generator] ?? 0) + 1;
  return {
    persona,
    defenses: list.length,
    failed: list.length - ok.length,
    totals,
    meanTotal: mean(totals),
    passRate: ok.length ? ok.filter((d) => d.passed).length / ok.length : null,
    flagRate: ok.length ? ok.filter((d) => d.flags.includes(FLAG_STRONG_WEAK)).length / ok.length : null,
    unevenRate: ok.length ? ok.filter((d) => d.flags.includes('uneven_understanding')).length / ok.length : null,
    knownItemMean: knownFiles.length ? mean(withRef.filter((i) => isKnown(i.ref)).map((i) => i.total)) : null,
    unknownItemMean: knownFiles.length ? mean(withRef.filter((i) => !isKnown(i.ref)).map((i) => i.total)) : null,
    itemSpreadMean: mean(items.filter((i) => i.runs.length > 1).map((i) => spread(i.runs))),
    avgEvaluatorRuns: mean(ok.filter((d) => d.items?.length).map((d) => d.items![0]!.runs.length)),
    withinSpreadMean: mean(within),
    withinSpreadMax: within.length ? Math.max(...within) : 0,
    betweenSpread: spread(totals),
    disagreementFlags: ok.filter((d) => d.flags.includes('evaluator_disagreement')).length,
    avgAnswered: mean(ok.map((d) => d.answered)),
    avgPlatformCalls: mean(ok.map((d) => d.platform.calls)),
    avgPersonaCalls: mean(ok.map((d) => d.persona_llm.calls)),
    avgPlatformTokens: mean(ok.map((d) => d.platform.inputTokens + d.platform.outputTokens)),
    qlcGenerators: gens,
  };
}

/** Попарное разведение персон защиты по сумме рубрики: «AUC» a над b. */
export function defenseSeparation(summaries: readonly DefensePersonaSummary[]): { a: string; b: string; auc: number | null }[] {
  const out: { a: string; b: string; auc: number | null }[] = [];
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      out.push({ a: summaries[i]!.persona, b: summaries[j]!.persona, auc: r2(separation(summaries[i]!.totals, summaries[j]!.totals)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Таблицы markdown (для docs/validation-stages.md)
// ---------------------------------------------------------------------------
const pct = (x: number | null): string => (x === null ? '–' : `${Math.round(x * 100)} %`);
const num = (x: number | null, d = 1): string => (x === null ? '–' : x.toFixed(d).replace('.', ','));
const mark = (g: boolean | 'inconclusive' | null): string => (g === null ? '·' : g === 'inconclusive' ? '?' : g ? '✓' : '✗');

export function callTables(summaries: readonly CallPersonaSummary[], legends: Record<string, string>): string {
  const head = [
    '| Персона | Созвонов | Подтверждено тем | Совпало с ожиданием | Покрытие заявленных тем | Разброс суммы между прогонами (ср./макс.) | Решение одинаково во всех прогонах | Одинаково между созвонами | Вызовов LLM на созвон (платформа + персона) | Токенов платформы на созвон |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  const rows = summaries.map(
    (s) =>
      `| ${s.persona} ${legends[s.persona] ?? ''} | ${s.calls - s.failedCalls}/${s.calls} | ${pct(s.confirmedShare)} | ${pct(s.matchRate)} (${s.matched}/${s.judged}) | ${pct(s.coverage)} | ${num(s.withinSpreadMean)} / ${s.withinSpreadMax} | ${pct(s.withinPassAgreement)} | ${pct(s.betweenAgreement)} | ${num(s.avgPlatformCalls)} + ${num(s.avgPersonaCalls)} | ${num(s.avgPlatformTokens, 0)} |`,
  );
  const maps = summaries.map((s) => {
    const lines = s.topics.map(
      (t) => `| ${s.persona} | \`${t.catalogId}\` | ${t.expected === null ? '–' : t.expected ? 'да' : 'нет'} | ${t.got.map(mark).join(' ')} | ${t.totals.map((x) => (x === null ? '·' : String(x))).join(' / ')} |`,
    );
    return lines.join('\n');
  });
  return [
    ...head,
    ...rows,
    '',
    'Карта «тема → ожидалось → получено» (по созвонам: ✓ подтверждено, ✗ нет, · тему не спросили; сумма медиан 0–8):',
    '',
    '| Персона | Тема | Ожидалось | Получено | Сумма |',
    '|---|---|---|---|---|',
    ...maps,
  ].join('\n');
}

export function defenseTables(summaries: readonly DefensePersonaSummary[], legends: Record<string, string>): string {
  const head = [
    '| Персона | Защит | Сумма рубрики по защитам (0–8) | Средняя | Прошли порог | Флаг strong_project_weak_defense | Разброс между прогонами (ср./макс.) | Разброс между защитами | Ответов | Вызовов LLM на защиту (платформа + персона) | Токенов платформы |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const rows = summaries.map(
    (s) =>
      `| ${s.persona} ${legends[s.persona] ?? ''} | ${s.defenses - s.failed}/${s.defenses} | ${s.totals.join(' / ') || '–'} | ${num(s.meanTotal)} | ${pct(s.passRate)} | ${pct(s.flagRate)} | ${num(s.withinSpreadMean)} / ${s.withinSpreadMax} | ${s.betweenSpread} | ${num(s.avgAnswered)} | ${num(s.avgPlatformCalls)} + ${num(s.avgPersonaCalls)} | ${num(s.avgPlatformTokens, 0)} |`,
  );
  const sep = defenseSeparation(summaries).map((x) => `| ${x.a} над ${x.b} | ${x.auc === null ? '–' : x.auc.toFixed(2).replace('.', ',')} |`);
  return [...head, ...rows, '', '| Разведение (AUC по сумме; 1 – полностью, 0,5 – не различает) | AUC |', '|---|---|', ...sep].join('\n');
}

// ---------------------------------------------------------------------------
// Таблицы «после доработки 10.10» (статусы тем, баллы по вопросам защиты)
// ---------------------------------------------------------------------------
export function callTuningTable(summaries: readonly CallPersonaSummary[], legends: Record<string, string>): string {
  return [
    '| Персона | Созвонов | Совпало с ожиданием (решённые темы) | Ошибок решения | Не определено | Покрытие заявленных тем | Пересказов профиля в вопросах | Доп. вопросов на созвон | Прогонов оценщика на созвон | Вызовов платформы на созвон | Токенов платформы на созвон |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...summaries.map(
      (s) =>
        `| ${s.persona} ${legends[s.persona] ?? ''} | ${s.calls - s.failedCalls}/${s.calls} | ${s.matched}/${s.judged - s.inconclusive} | ${s.wrongDecisions} | ${s.inconclusive} | ${pct(s.coverage)} | ${s.retoldQuestions} | ${num(s.avgProbeQuestions)} | ${num(s.avgEvaluatorRuns)} | ${num(s.avgPlatformCalls)} | ${num(s.avgPlatformTokens, 0)} |`,
    ),
  ].join('\n');
}

export function defenseTuningTable(summaries: readonly DefensePersonaSummary[], legends: Record<string, string>): string {
  const sep = defenseSeparation(summaries).map((x) => `| ${x.a} над ${x.b} | ${x.auc === null ? '–' : x.auc.toFixed(2).replace('.', ',')} |`);
  return [
    '| Персона | Защит | Общий балл по защитам (среднее по вопросам, 0–8) | Средняя | Прошли порог | strong_project_weak_defense | uneven_understanding | Балл вопросов по «своим» / остальным файлам | Разброс суммы вопроса между прогонами | Прогонов оценщика | Вызовов платформы на защиту | Токенов платформы |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...summaries.map(
      (s) =>
        `| ${s.persona} ${legends[s.persona] ?? ''} | ${s.defenses - s.failed}/${s.defenses} | ${s.totals.map((t) => num(t)).join(' / ') || '–'} | ${num(s.meanTotal)} | ${pct(s.passRate)} | ${pct(s.flagRate)} | ${pct(s.unevenRate)} | ${num(s.knownItemMean)} / ${num(s.unknownItemMean)} | ${num(s.itemSpreadMean)} | ${num(s.avgEvaluatorRuns)} | ${num(s.avgPlatformCalls)} | ${num(s.avgPlatformTokens, 0)} |`,
    ),
    '',
    '| Разведение (AUC по общему баллу; 1 – полностью, 0,5 – не различает) | AUC |',
    '|---|---|',
    ...sep,
  ].join('\n');
}
