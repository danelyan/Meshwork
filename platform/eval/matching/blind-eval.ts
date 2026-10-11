// Оценка подбора на независимой (слепой) разметке (11.10). Без БД и сети.
//   npx tsx eval/matching/export-blind.ts             # 1) выгрузка blind/items.json для размечающих
//   (два ИИ-агента разных моделей размечают 0/1/2 → blind/labels-a.json, blind/labels-b.json)
//   npx tsx eval/matching/blind-eval.ts [--no-write]  # 2) κ, P@5/nDCG@10 по A, B, консенсусу; ключ blind в results.json
// Пул разметки – top-30 объединения выдач ours и BM25; кандидаты вне пула считаются нерелевантными (стандартное
// допущение пулинга, как в TREC). У ours и BM25 первые 10 мест всегда внутри пула; у базовой линии – нет, это занижает её.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLIND_POOL, buildBlindSet, rankBaselineClaims, rankBm25, rankOurs } from './blind-set';
import { bootstrapDiff, bootstrapMean, consensusOf, ndcgAtK, precisionAtK, weightedKappa, type Interval } from './metrics';
import { SYN_SEED } from './synthetic';

const here = dirname(fileURLToPath(import.meta.url));
const REPS = 1000;
type Labels = Record<string, Record<string, number>>;
const SETS = ['a', 'b', 'consensus', 'generator'] as const;
type SetName = (typeof SETS)[number];
const METHODS = ['ours', 'bm25', 'baselineClaims'] as const;
type Method = (typeof METHODS)[number];


function readLabels(name: string): Labels {
  const dir = process.argv.find((a) => a.startsWith('--labels-dir='))?.slice('--labels-dir='.length) ?? join(here, 'blind');
  const j = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Labels;
  for (const [v, m] of Object.entries(j)) for (const [c, x] of Object.entries(m)) if (![0, 1, 2].includes(x)) throw new Error(`${name}: ${v}/${c} = ${x}`);
  return j;
}

const { items, key, syn } = buildBlindSet();
const A = readLabels('labels-a.json');
const B = readLabels('labels-b.json');

// пары в одном порядке; пропуски – ошибка
const pairs: { v: string; c: string; pid: string; a: number; b: number; g: number }[] = [];
for (const it of items) for (const c of it.candidates) {
  const a = A[it.vacancyId]?.[c.candidateId], b = B[it.vacancyId]?.[c.candidateId];
  if (a === undefined || b === undefined) throw new Error(`нет оценки ${it.vacancyId}/${c.candidateId} (A: ${a}, B: ${b})`);
  const pid = key[it.vacancyId]!.candidates[c.candidateId]!;
  pairs.push({ v: it.vacancyId, c: c.candidateId, pid, a, b, g: syn.relevance[key[it.vacancyId]!.vacancy]?.[pid] ?? 0 });
}
const col = (s: SetName) => pairs.map((p) => (s === 'a' ? p.a : s === 'b' ? p.b : s === 'generator' ? p.g : consensusOf(p.a, p.b)));
const kappa = {
  ab: weightedKappa(col('a'), col('b')),
  aVsGenerator: weightedKappa(col('a'), col('generator')),
  bVsGenerator: weightedKappa(col('b'), col('generator')),
  consensusVsGenerator: weightedKappa(col('consensus'), col('generator')),
};
const exactAgreementAB = pairs.filter((p) => p.a === p.b).length / pairs.length;
const dist = (s: SetName) => { const x = col(s); return { rel0: x.filter((z) => z === 0).length / x.length, rel1: x.filter((z) => z === 1).length / x.length, rel2: x.filter((z) => z === 2).length / x.length }; };

// выдачи по вакансиям (по исходному id профиля)
const lists = items.map((it) => {
  const v = syn.vacancies.find((x) => x.id === key[it.vacancyId]!.vacancy)!;
  return { blind: it.vacancyId, v, ours: rankOurs(v, syn.profiles), bm25: rankBm25(v, syn.profiles), baselineClaims: rankBaselineClaims(v, syn.profiles) };
});
const relOf = (s: SetName, blindV: string): Record<string, number> => {
  const out: Record<string, number> = {};
  const vals = col(s);
  pairs.forEach((p, i) => { if (p.v === blindV) out[p.pid] = vals[i]!; });
  return out;
};
const pooled = new Map(lists.map((l) => [l.blind, new Set(Object.values(key[l.blind]!.candidates))]));
const coverageTop10 = Object.fromEntries(METHODS.map((m) => [m, lists.reduce((s, l) => s + l[m].slice(0, 10).filter((id) => pooled.get(l.blind)!.has(id)).length, 0) / (10 * lists.length)])) as Record<Method, number>;

type MetricIv = { p5: Interval; p5strict: Interval; ndcg10: Interval };
/** P@5 строгая: релевантным считается только «сильный кандидат» (2). */
const strict = (rel: Record<string, number>) => Object.fromEntries(Object.entries(rel).map(([k, x]) => [k, x === 2 ? 1 : 0]));
interface SetResult { methods: Record<Method, MetricIv>; deltaOursMinusBm25: MetricIv; deltaOursMinusBaselineClaims: MetricIv; perVacancy: { vacancy: string; ours: { p5: number; ndcg10: number }; bm25: { p5: number; ndcg10: number } }[] }
const sets = {} as Record<SetName, SetResult>;
SETS.forEach((s, si) => {
  const per = {} as Record<Method, { p5: number[]; p5strict: number[]; ndcg10: number[] }>;
  for (const m of METHODS) per[m] = { p5: [], p5strict: [], ndcg10: [] };
  for (const l of lists) {
    const rel = relOf(s, l.blind);
    for (const m of METHODS) { per[m].p5.push(precisionAtK(l[m], rel, 5)); per[m].p5strict.push(precisionAtK(l[m], strict(rel), 5)); per[m].ndcg10.push(ndcgAtK(l[m], rel, 10)); }
  }
  const seed = SYN_SEED + 31 * si;
  const methods = Object.fromEntries(METHODS.map((m, mi) => [m, { p5: bootstrapMean(per[m].p5, REPS, seed + mi), p5strict: bootstrapMean(per[m].p5strict, REPS, seed + 20 + mi), ndcg10: bootstrapMean(per[m].ndcg10, REPS, seed + 10 + mi) }])) as Record<Method, MetricIv>;
  const delta = (o: Method, salt: number): MetricIv => ({ p5: bootstrapDiff(per.ours.p5, per[o].p5, REPS, seed + salt), p5strict: bootstrapDiff(per.ours.p5strict, per[o].p5strict, REPS, seed + salt + 2), ndcg10: bootstrapDiff(per.ours.ndcg10, per[o].ndcg10, REPS, seed + salt + 1) });
  sets[s] = {
    methods, deltaOursMinusBm25: delta('bm25', 100), deltaOursMinusBaselineClaims: delta('baselineClaims', 200),
    perVacancy: lists.map((l, i) => ({ vacancy: `${l.blind} ${l.v.specialization} ${l.v.grade}`, ours: { p5: per.ours.p5[i]!, ndcg10: per.ours.ndcg10[i]! }, bm25: { p5: per.bm25.p5[i]!, ndcg10: per.bm25.ndcg10[i]! } })),
  };
});

const f = (x: number) => x.toFixed(3);
const fi = (i: Interval) => `${f(i.mean)} [${f(i.lo)}; ${f(i.hi)}]`;
console.log(`Слепая разметка: ${items.length} вакансий × ${BLIND_POOL} кандидатов = ${pairs.length} пар`);
console.log(`κ (взвеш., квадр.) A–B ${f(kappa.ab)}, точное совпадение ${f(exactAgreementAB)}; A–генератор ${f(kappa.aVsGenerator)}, B–генератор ${f(kappa.bVsGenerator)}, консенсус–генератор ${f(kappa.consensusVsGenerator)}`);
for (const s of SETS) { const d = dist(s); console.log(`  доли 0/1/2 ${s.padEnd(9)} ${f(d.rel0)} / ${f(d.rel1)} / ${f(d.rel2)}`); }
console.log(`покрытие разметкой top-10: ${METHODS.map((m) => `${m} ${f(coverageTop10[m])}`).join(', ')}`);
for (const s of SETS) {
  const row = (x: MetricIv) => `${fi(x.p5).padEnd(24)} ${fi(x.p5strict).padEnd(24)} ${fi(x.ndcg10)}`;
  console.log(`\nразметка ${s}:             P@5 (≥1)                 P@5 (=2)                 nDCG@10`);
  for (const m of METHODS) console.log(`  ${m.padEnd(15)} ${row(sets[s].methods[m])}`);
  console.log(`  ours − bm25     ${row(sets[s].deltaOursMinusBm25)}`);
  console.log(`  ours − baseline ${row(sets[s].deltaOursMinusBaselineClaims)}`);
}
console.log('\nпо вакансиям (консенсус), ours vs bm25 nDCG@10:');
for (const r of sets.consensus.perVacancy) console.log(`  ${r.vacancy.padEnd(28)} ${f(r.ours.ndcg10)}  ${f(r.bm25.ndcg10)}`);

if (!process.argv.includes('--no-write')) {
  const path = join(here, 'results.json');
  const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  prev.blind = {
    note: 'Независимая слепая разметка 0/1/2: два ИИ-агента разных моделей (A – Claude Sonnet, B – Claude Opus), не люди; видели только текст вакансии и профиля (eval/matching/blind/items.json), без скрытой истины генератора и баллов. Пул – top-30 объединения выдач ours и BM25, вне пула – 0. Консенсус – среднее A и B, округлённое (половина вверх). Интервалы – бутстреп по 6 вакансиям, 1000 повторов, 95 %: широкие.',
    vacancies: items.length, pool: BLIND_POOL, pairs: pairs.length,
    labelers: { a: 'Claude Sonnet', b: 'Claude Opus' },
    kappa, exactAgreementAB,
    distribution: Object.fromEntries(SETS.map((s) => [s, dist(s)])),
    coverageTop10,
    sets,
  };
  writeFileSync(path, `${JSON.stringify(prev, null, 2)}\n`);
  console.log('\nзаписано: eval/matching/results.json (ключ blind)');
}
