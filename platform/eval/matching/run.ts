// Валидация подбора работодателя (Q-07, критерий 1). Без БД и сети.
//   npx tsx eval/matching/run.ts            # таблица + eval/matching/results.json
//   npx tsx eval/matching/run.ts --no-write
// Ранжирует 16 профилей (8 демо-пула + 8 «трудных») под 8 демо-вакансий тем же
// кодом, что и кабинет (src/server/employer/ranking.ts), и сравнивает с разметкой
// labels.json (разметка агента, 3 уровня). Базовая линия — «больше подтверждённых
// утверждений своей специализации выше», без учёта требований вакансии.
// Замер идёт в режиме расширенного пула (EVAL_FILTERS: expandPool), как и до 11.10, когда кабинет показывал
// кандидатов без категории всегда: часть профилей набора без категории, и без флага они выпали бы из выдачи,
// а цифры results.json молча изменились бы. Основной режим кабинета (только категории) отдельно не измерен.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_POOL, type DemoProfile } from '../../prisma/seed/employer';
import { DEMO_VACANCIES } from '../../prisma/seed/recommend';
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { dropUncovered, rankCandidates, type CandidateEvidence, type MatchFilters } from '../../src/server/employer/ranking';

import { EXTRA_PROFILES } from './extra-profiles';
import { bm25Rank } from './bm25';
import {
  bootstrapDiff, bootstrapMean, maxPrecisionAtK, mulberry32, ndcgAtK, precisionAtK, recallAtK, reciprocalRank, type Interval,
} from './metrics';
import { ARCHETYPE_LABEL, generateSynthetic, SYN_SEED, type SynProfile } from './synthetic';

const K = 5;
const here = dirname(fileURLToPath(import.meta.url));
const labels = JSON.parse(readFileSync(join(here, 'labels.json'), 'utf8')) as {
  candidates: string[];
  relevance: Record<string, Record<string, number>>;
};

const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const profiles: DemoProfile[] = [...DEMO_POOL, ...EXTRA_PROFILES];
const evidence: CandidateEvidence[] = profiles.map((p) => ({
  id: p.id,
  specialization: p.specialization,
  fspState: p.fspState,
  category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
}));

const missing = labels.candidates.filter((id) => !profiles.some((p) => p.id === id));
if (missing.length) throw new Error(`В разметке есть кандидаты без профиля: ${missing.join(', ')}`);

function baseline(spec: string): string[] {
  return [...evidence]
    .filter((c) => c.specialization === spec)
    .sort((a, b) => b.claims.length - a.claims.length || a.id.localeCompare(b.id))
    .map((c) => c.id);
}

/** Расширенный пул: профили без категории участвуют в замере (см. шапку файла). */
const EVAL_FILTERS: MatchFilters = { expandPool: true };

interface Row { vacancy: string; p: number; pMax: number; ndcg: number; bP: number; bNdcg: number; top: string[] }
const rows: Row[] = [];
for (const v of DEMO_VACANCIES) {
  const rel = labels.relevance[v.id] ?? {};
  const ranked = dropUncovered(rankCandidates(evidence, {
    specialization: v.specialization,
    grade: v.grade,
    needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })),
    stack: [],
  }, catalog, EVAL_FILTERS)).map((r) => r.candidateId);
  const b = baseline(v.specialization);
  rows.push({
    vacancy: v.id,
    p: precisionAtK(ranked, rel, K),
    pMax: maxPrecisionAtK(rel, K),
    ndcg: ndcgAtK(ranked, rel, K),
    bP: precisionAtK(b, rel, K),
    bNdcg: ndcgAtK(b, rel, K),
    top: ranked.slice(0, K),
  });
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const f = (x: number) => x.toFixed(3);
console.log(`Подбор: ${profiles.length} профилей × ${DEMO_VACANCIES.length} вакансий, k = ${K}\n`);
console.log('вакансия            P@5    потолок  nDCG@5 | база P@5  база nDCG@5');
for (const r of rows) console.log(`${r.vacancy.padEnd(18)}  ${f(r.p)}  ${f(r.pMax)}    ${f(r.ndcg)} | ${f(r.bP)}     ${f(r.bNdcg)}`);
const summary = {
  k: K,
  profiles: profiles.length,
  vacancies: rows.length,
  precisionAt5: mean(rows.map((r) => r.p)),
  precisionAt5Ceiling: mean(rows.map((r) => r.pMax)),
  ndcgAt5: mean(rows.map((r) => r.ndcg)),
  baseline: { precisionAt5: mean(rows.map((r) => r.bP)), ndcgAt5: mean(rows.map((r) => r.bNdcg)) },
};
console.log(`\nсреднее              ${f(summary.precisionAt5)}  ${f(summary.precisionAt5Ceiling)}    ${f(summary.ndcgAt5)} | ${f(summary.baseline.precisionAt5)}     ${f(summary.baseline.ndcgAt5)}`);

// ---------------------------------------------------------------- расширенный набор (10.10)
const BOOT_REPS = 1000;
const RANDOM_DRAWS = 50;
const METRICS = ['p5', 'p10', 'ndcg10', 'recall50', 'mrr'] as const;
type MetricName = (typeof METRICS)[number];
type MethodName = 'ours' | 'baselineClaims' | 'bm25' | 'random';
const METHODS: MethodName[] = ['ours', 'baselineClaims', 'bm25', 'random'];

interface EvalVacancy { id: string; specialization: 'backend' | 'frontend' | 'ai' | 'engineering'; grade: 'junior' | 'middle' | 'senior'; needs: [string, number][]; stack: string[]; text: string }
interface EvalProfile extends DemoProfile { text: string }

function perVacancyMetrics(ranked: string[], rel: Record<string, number>): Record<MetricName, number | null> {
  return { p5: precisionAtK(ranked, rel, 5), p10: precisionAtK(ranked, rel, 10), ndcg10: ndcgAtK(ranked, rel, 10), recall50: recallAtK(ranked, rel, 50), mrr: reciprocalRank(ranked, rel) };
}

function rankers(ps: EvalProfile[], seed: number): Record<MethodName, (v: EvalVacancy, vi: number) => string[][]> {
  const ev: CandidateEvidence[] = ps.map((p) => ({
    id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
    claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
  }));
  const docs = ps.map((p) => ({ id: p.id, text: p.text }));
  return {
    ours: (v) => [dropUncovered(rankCandidates(ev, { specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: v.stack }, catalog, EVAL_FILTERS)).map((r) => r.candidateId)],
    baselineClaims: (v) => [[...ev].filter((c) => c.specialization === v.specialization).sort((a, b) => b.claims.length - a.claims.length || a.id.localeCompare(b.id)).map((c) => c.id)],
    bm25: (v) => [bm25Rank(docs, v.text).map((d) => d.id)],
    random: (_v, vi) => {
      const rnd = mulberry32(seed + 1000 * (vi + 1));
      return Array.from({ length: RANDOM_DRAWS }, () => ps.map((p) => ({ id: p.id, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.id));
    },
  };
}

type Cell = { relevantPairs: number; hitTop10: number; top5Slots: number; falseInTop5: number };
interface ExtendedResult {
  vacancies: number; profiles: number; seed: number; relevantPerVacancy: { min: number; median: number; max: number };
  relevanceShare: { rel0: number; rel1: number; rel2: number };
  methods: Record<MethodName, Record<MetricName, Interval>>;
  deltaOursMinusBm25: Record<MetricName, Interval>;
  deltaOursMinusBaselineClaims: Record<MetricName, Interval>;
  perVacancy: { vacancy: string; relevant: number; ours: Record<MetricName, number | null>; bm25: Record<MetricName, number | null> }[];
  byArchetype?: Record<string, Record<MethodName, Cell>>;
  oursWorseThanBm25: { vacancy: string; metric: MetricName; ours: number; bm25: number }[];
}

function evaluate(vs: EvalVacancy[], ps: EvalProfile[], rel: Record<string, Record<string, number>>, seed: number, withArch: Map<string, string> | null): ExtendedResult {
  const rk = rankers(ps, seed);
  const per = {} as Record<MethodName, Record<MetricName, (number | null)[]>>;
  for (const m of METHODS) { per[m] = {} as never; for (const x of METRICS) per[m][x] = []; }
  const arch: Record<string, Record<MethodName, Cell>> = {};
  vs.forEach((v, vi) => {
    const r = rel[v.id] ?? {};
    for (const m of METHODS) {
      const lists = rk[m](v, vi);
      const rows = lists.map((l) => perVacancyMetrics(l, r));
      for (const x of METRICS) {
        const vals = rows.map((row) => row[x]).filter((z): z is number => z !== null);
        per[m][x].push(vals.length ? vals.reduce((s, z) => s + z, 0) / vals.length : null);
      }
      if (withArch) {
        const list = lists[0]!;
        const top10 = new Set(list.slice(0, 10));
        const top5 = new Set(list.slice(0, 5));
        for (const p of ps) {
          const a = withArch.get(p.id)!;
          const byM = (arch[a] ??= {} as never);
          const cell = (byM[m] ??= { relevantPairs: 0, hitTop10: 0, top5Slots: 0, falseInTop5: 0 });
          if ((r[p.id] ?? 0) > 0) { cell.relevantPairs++; if (top10.has(p.id)) cell.hitTop10++; }
          if (top5.has(p.id)) { cell.top5Slots++; if ((r[p.id] ?? 0) === 0) cell.falseInTop5++; }
        }
      }
    }
  });
  const iv = (vals: (number | null)[], salt: number): Interval => bootstrapMean(vals.filter((z): z is number => z !== null), BOOT_REPS, seed + salt);
  const methods = {} as ExtendedResult['methods'];
  METHODS.forEach((m, mi) => { methods[m] = {} as never; METRICS.forEach((x, xi) => { methods[m][x] = iv(per[m][x], 17 * mi + xi); }); });
  const delta = (other: MethodName) => {
    const out = {} as Record<MetricName, Interval>;
    METRICS.forEach((x, xi) => {
      const idx = per.ours[x].map((_, i) => i).filter((i) => per.ours[x][i] !== null && per[other][x][i] !== null);
      out[x] = bootstrapDiff(idx.map((i) => per.ours[x][i]!), idx.map((i) => per[other][x][i]!), BOOT_REPS, seed + 900 + xi);
    });
    return out;
  };
  const relOf = (v: EvalVacancy) => Object.values(rel[v.id] ?? {}).filter((z) => z > 0).length;
  const relCounts = vs.map(relOf).sort((a, b) => a - b);
  const all = vs.flatMap((v) => Object.values(rel[v.id] ?? {}));
  const share = (k: number) => all.filter((z) => z === k).length / all.length;
  const worse: ExtendedResult['oursWorseThanBm25'] = [];
  vs.forEach((v, i) => { for (const x of ['p10', 'ndcg10'] as const) { const o = per.ours[x][i] ?? null, b = per.bm25[x][i] ?? null; if (o !== null && b !== null && o < b - 0.05) worse.push({ vacancy: v.id, metric: x, ours: o, bm25: b }); } });
  const pv = (m: MethodName, i: number) => Object.fromEntries(METRICS.map((x) => [x, per[m][x][i]])) as Record<MetricName, number | null>;
  return {
    vacancies: vs.length, profiles: ps.length, seed,
    relevantPerVacancy: { min: relCounts[0]!, median: relCounts[Math.floor(relCounts.length / 2)]!, max: relCounts[relCounts.length - 1]! },
    relevanceShare: { rel0: share(0), rel1: share(1), rel2: share(2) },
    methods, deltaOursMinusBm25: delta('bm25'), deltaOursMinusBaselineClaims: delta('baselineClaims'),
    perVacancy: vs.map((v, i) => ({ vacancy: v.id, relevant: relOf(v), ours: pv('ours', i), bm25: pv('bm25', i) })),
    ...(withArch ? { byArchetype: arch } : {}),
    oursWorseThanBm25: worse,
  };
}

const plainText = (p: DemoProfile) => [
  p.category ? `${p.category.specialization} ${p.category.grade}` : '', p.stack.join(' '),
  ...p.claims.map(([id]) => catalog.get(id)?.statement ?? id),
].filter(Boolean).join('. ');

// (1) малый набор — те же 17 профилей × 8 вакансий, плюс BM25 и случайный порядок и полный набор метрик
const legacyVacancies: EvalVacancy[] = DEMO_VACANCIES.map((v) => ({
  id: v.id, specialization: v.specialization, grade: v.grade, needs: v.needs.map(([a, b]) => [a, b] as [string, number]), stack: [],
  text: [v.title, ...v.needs.map(([id]) => catalog.get(id)?.statement ?? id)].join('. '),
}));
const legacyProfiles: EvalProfile[] = profiles.map((p) => ({ ...p, text: plainText(p) }));
const legacy = evaluate(legacyVacancies, legacyProfiles, labels.relevance, SYN_SEED, null);

// (2) синтетический набор с разметкой по скрытой истине
const syn = generateSynthetic(SYN_SEED);
const archOf = new Map(syn.profiles.map((p: SynProfile) => [p.id, p.archetype] as [string, string]));
const extended = evaluate(syn.vacancies, syn.profiles, syn.relevance, SYN_SEED, archOf);
const archSizes: Record<string, number> = {};
for (const p of syn.profiles) archSizes[p.archetype] = (archSizes[p.archetype] ?? 0) + 1;

const fi = (i: Interval) => `${f(i.mean)} [${f(i.lo)}; ${f(i.hi)}]`;
function printTable(title: string, r: ExtendedResult) {
  console.log(`\n${title}: ${r.profiles} профилей × ${r.vacancies} вакансий, релевантных на вакансию ${r.relevantPerVacancy.min}–${r.relevantPerVacancy.max} (медиана ${r.relevantPerVacancy.median})`);
  console.log('метод              P@5                    P@10                   nDCG@10                Recall@50              MRR');
  for (const m of METHODS) console.log(`${m.padEnd(17)}  ${METRICS.map((x) => fi(r.methods[m][x]).padEnd(21)).join('  ')}`);
  console.log(`ours - BM25        ${METRICS.map((x) => fi(r.deltaOursMinusBm25[x]).padEnd(21)).join('  ')}`);
}
printTable('Малый набор (разметка агента)', legacy);
printTable('Расширенный набор (скрытая истина)', extended);
console.log(`\nВакансий, где наш подбор хуже BM25 больше чем на 0,05 (P@10 или nDCG@10): ${new Set(extended.oursWorseThanBm25.map((x) => x.vacancy)).size} из ${extended.vacancies}`);

if (!process.argv.includes('--no-write')) {
  writeFileSync(join(here, 'results.json'), `${JSON.stringify({ summary, rows, legacyExtended: legacy, extended: { ...extended, archetypes: Object.fromEntries(Object.entries(archSizes).map(([k, n]) => [k, { profiles: n, label: ARCHETYPE_LABEL[k as keyof typeof ARCHETYPE_LABEL] }])), note: 'Разметка 0/1/2 — из скрытых латентных навыков и грейда генератора (eval/matching/synthetic.ts, truthRelevance), не из формулы подбора. Интервалы — бутстреп по вакансиям, 1000 повторов, 95 %.' } }, null, 2)}\n`);
  console.log('\nзаписано: eval/matching/results.json');
}
