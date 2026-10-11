// Индекс честности теста в подборе (11.10): вариант 1 (только метка у работодателя) против варианта 2
// (кандидат с high опускается: 2a — категория не учитывается, 2b — балл × factor). Без БД и сети.
//   npx tsx eval/matching/integrity.ts            # таблицы + ключ integrityRanking в eval/matching/results.json
//   npx tsx eval/matching/integrity.ts --no-write [--reps 1000]
//   npx tsx eval/matching/integrity.ts --call     # 1 vs 2a vs 2a + снятие созвоном → ключ integrityRankingCall
// Уровни индекса — жребий по долям из симуляции теста (eval/test/integrity-results.json), не из живых людей.
// Набор профилей фиксирован (seed); в каждом повторе перетягивается индекс (и, для «малого пула», подвыборка профилей).
// Метрики по запросу усредняются по повторам, затем бутстреп по запросам, как в run.ts.
//
// Два режима запросов, как в кабинете (matching.ts):
//  - подборка под вакансию: rankCandidates + dropUncovered, 24 вакансии synthetic.ts, разметка truthRelevance;
//  - поиск по банку с фильтром категории (searchBank, фильтр специализация + грейд): 12 запросов; разметка — «категория
//    заслужена»: у кандидата категория фильтра и латентный грейд не ниже — 2, иначе 0 (покрытие полной сигнатуры категории
//    у синтетики почти всегда ниже порога, поэтому truthRelevance здесь вырождается в 0).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_POOL } from '../../prisma/seed/employer';
import { DEMO_VACANCIES } from '../../prisma/seed/recommend';
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import {
  applyIntegrity, categoryNeeds, compareRanked, dropUncovered, passesFilters, rankCandidates, scoreCandidate,
  type CandidateEvidence, type MatchFilters, type MatchTarget, type RankedCandidate, type RankOptions,
} from '../../src/server/employer/ranking';

import { EXTRA_PROFILES } from './extra-profiles';
import { bootstrapDiff, bootstrapMean, mulberry32, ndcgAtK, precisionAtK, reciprocalRank, type Interval } from './metrics';
import {
  drawIntegrity, generateSynthetic, integrityRatesFromSimulation, SYN_SEED, withHonestHigh,
  type IntegrityLevel, type IntegrityRates, type SynGrade, type SynProfile, type SynSet,
} from './synthetic';

const here = dirname(fileURLToPath(import.meta.url));
const argReps = process.argv.indexOf('--reps');
const REPS = argReps > 0 ? Number(process.argv[argReps + 1]) : 1000;
const BOOT_REPS = 1000;
const BASE_PROFILES = 247;
/** «Малый пул»: размер подвыборки (закрытый набор жюри неизвестен — допущение). */
const THIN_POOL = 60;
const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const simulation = JSON.parse(readFileSync(join(here, '../test/integrity-results.json'), 'utf8')) as Parameters<typeof integrityRatesFromSimulation>[0];

/**
 * Снятие понижения созвоном (режим --call, решение владельца 11.10): у кандидата с high созвон с разбором теста случился с
 * вероятностью share и дал «объяснил сам» с вероятностью honest / cheat. Чисел из живых данных нет (validation-results.md:
 * «Точность оценщика „решил сам“ на людях и на подсказках нейросети не измерена») — сценарии-допущения.
 */
interface Lift { share: number; honest: number; cheat: number }
interface Variant { name: string; label: string; opts: RankOptions; lift?: Lift }
const CALL_MODE = process.argv.includes('--call');
const DROP: RankOptions = { integrityPenalty: { mode: 'drop_category' } };
const VARIANTS: Variant[] = CALL_MODE ? [
  { name: 'v1', label: '1: только метка', opts: {} },
  { name: 'v2a', label: '2a: без созвона', opts: DROP },
  { name: 'v2a-call-0.8-0.2', label: '2a + созвон у всех, 0,8/0,2', opts: DROP, lift: { share: 1, honest: 0.8, cheat: 0.2 } },
  { name: 'v2a-call-0.9-0.1', label: '2a + созвон у всех, 0,9/0,1', opts: DROP, lift: { share: 1, honest: 0.9, cheat: 0.1 } },
  { name: 'v2a-call50-0.8-0.2', label: '2a + созвон у половины, 0,8/0,2', opts: DROP, lift: { share: 0.5, honest: 0.8, cheat: 0.2 } },
  { name: 'v2a-call50-0.9-0.1', label: '2a + созвон у половины, 0,9/0,1', opts: DROP, lift: { share: 0.5, honest: 0.9, cheat: 0.1 } },
] : [
  { name: 'v1', label: '1: только метка', opts: {} },
  { name: 'v2a', label: '2a: категория не учитывается', opts: DROP },
  { name: 'v2b-0.85', label: '2b: балл × 0,85', opts: { integrityPenalty: { mode: 'multiplier', factor: 0.85 } } },
  { name: 'v2b-0.7', label: '2b: балл × 0,7', opts: { integrityPenalty: { mode: 'multiplier', factor: 0.7 } } },
  { name: 'v2b-0.5', label: '2b: балл × 0,5', opts: { integrityPenalty: { mode: 'multiplier', factor: 0.5 } } },
];
const METRICS = ['ndcg10', 'p5', 'p10', 'mrr'] as const;
type MetricName = (typeof METRICS)[number];
const GRADE_RANK: Record<SynGrade, number> = { junior: 0, middle: 1, senior: 2 };

interface Scenario { id: string; label: string; fakedShare: number; trapP: 0.3 | 0.6 | 0.9; honestHigh?: Record<SynGrade, number> }
const SCENARIOS: Scenario[] = [
  { id: 'main', label: 'списанных 10 %, ловушка p = 0,6', fakedShare: 0.1, trapP: 0.6 },
  { id: 'faked0', label: 'списанных нет (только ложные high у честных)', fakedShare: 0, trapP: 0.6 },
  { id: 'faked5', label: 'списанных 5 %', fakedShare: 0.05, trapP: 0.6 },
  { id: 'faked20', label: 'списанных 20 %', fakedShare: 0.2, trapP: 0.6 },
  { id: 'trap03', label: 'списанных 10 %, ловушка p = 0,3', fakedShare: 0.1, trapP: 0.3 },
  { id: 'trap09', label: 'списанных 10 %, ловушка p = 0,9', fakedShare: 0.1, trapP: 0.9 },
  // validation-results.md § «Индекс честности…», чувствительность «жёсткий шум» (--sigma 0.6 --noise-tabs 1.5): high 2,4 / 3,0 / 1,2 %
  { id: 'honestHard', label: 'списанных 10 %, честные с жёстким шумом (high 2,4 / 3,0 / 1,2 %)', fakedShare: 0.1, trapP: 0.6, honestHigh: { junior: 2.4, middle: 3.0, senior: 1.2 } },
];

const toEvidence = (p: SynProfile, level?: IntegrityLevel, explained = false): CandidateEvidence => ({
  id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
  ...(level ? { testIntegrity: { level, ...(explained ? { ownershipExplained: true } : {}) } } : {}),
});

/** Запрос работодателя с предрасчитанными баллами: без флага и с флагом high (по вариантам). */
interface Query {
  id: string;
  rel: Record<string, number>;
  target: MatchTarget;
  filters: MatchFilters;
  requireCoverage: boolean;
  normal: (RankedCandidate | null)[];
  flagged: (RankedCandidate | null)[][];
}

function buildQueries(set: SynSet, mode: 'vacancy' | 'bank'): Query[] {
  const ps = set.profiles;
  const mk = (id: string, rel: Record<string, number>, target: MatchTarget, filters: MatchFilters, requireCoverage: boolean): Query => ({
    id, rel, target, filters, requireCoverage,
    normal: ps.map((p) => { const c = toEvidence(p); return passesFilters(c, filters) ? scoreCandidate(c, target, catalog) : null; }),
    flagged: VARIANTS.map((vr) => ps.map((p) => {
      if (!p.category) return null;
      const c = toEvidence(p, 'high');
      return passesFilters(applyIntegrity(c, vr.opts), filters) ? scoreCandidate(c, target, catalog, vr.opts) : null;
    })),
  });
  // Расширенный пул, как в кабинете до 11.10: профили без категории участвуют (иначе цифры § «Индекс честности в подборе» изменились бы молча).
  if (mode === 'vacancy') {
    return set.vacancies.map((v) => mk(v.id, set.relevance[v.id]!, { specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: v.stack }, { expandPool: true }, true));
  }
  const out: Query[] = [];
  for (const spec of ['backend', 'frontend', 'engineering', 'ai'] as const) {
    for (const grade of ['junior', 'middle', 'senior'] as const) {
      const rel: Record<string, number> = {};
      // Разметка банка: среди получивших категорию «spec × grade» — заслужил ли (латентный грейд не ниже). Остальные — 0:
      // фильтр их не выдаёт ни при одном варианте, идеальная выдача из них не строится.
      for (const p of ps) rel[p.id] = p.category?.specialization === spec && p.category.grade === grade && GRADE_RANK[p.trueGrade] >= GRADE_RANK[grade] ? 2 : 0;
      out.push(mk(`bank-${spec}-${grade}`, rel, { specialization: spec, grade, needs: categoryNeeds(catalog, spec, grade), stack: [] }, { specialization: spec, grade, expandPool: true }, false));
    }
  }
  return out;
}

interface HonestCost { events: number; inTop10V1: number; top10SlotsV1: number; lostTop10Slots: number; lostRelevantTop10Slots: number }
interface VariantStats {
  metrics: Record<MetricName, Interval>;
  deltaVsV1: Record<MetricName, Interval>;
  /** Доля мест топ-5 / топ-10, занятых «списанными» (среднее по запросам и повторам; пустые места — не списанные). */
  fakedShareTop5: number;
  fakedShareTop10: number;
  /** Сколько «списанных» с категорией под запрос попадали в выдачу вообще (среднее на запрос). */
  fakedListed: number;
  /** Честные с ложным high: события (профиль × повтор), из них в топ-10 хоть одного запроса при варианте 1, места и потери. */
  honestHigh: HonestCost;
}

function evaluate(set: SynSet, queries: Query[], rates: IntegrityRates, thin: { base: number; faked: number } | null) {
  const ps = set.profiles;
  const isFaked = ps.map((p) => p.archetype === 'category_faked');
  const order = (q: Query, k: number, high: (i: number) => boolean, inc: (i: number) => boolean): string[] => {
    const out: RankedCandidate[] = [];
    ps.forEach((_p, i) => { if (!inc(i)) return; const r = high(i) && k > 0 ? q.flagged[k]![i] : q.normal[i]; if (r && r.score > 0) out.push(r); });
    out.sort(compareRanked);
    return (q.requireCoverage ? dropUncovered(out) : out).map((r) => r.candidateId);
  };
  const idx = new Map(ps.map((p, i) => [p.id, i]));
  const sums = VARIANTS.map(() => queries.map(() => Object.fromEntries(METRICS.map((m) => [m, 0])) as Record<MetricName, number>));
  const f5 = VARIANTS.map(() => 0), f10 = VARIANTS.map(() => 0), listed = VARIANTS.map(() => 0);
  const hh: HonestCost[] = VARIANTS.map(() => ({ events: 0, inTop10V1: 0, top10SlotsV1: 0, lostTop10Slots: 0, lostRelevantTop10Slots: 0 }));
  let fakedHigh = 0, fakedSeen = 0, honestHighN = 0, honestCatN = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const levels = drawIntegrity(ps, rates, mulberry32(SYN_SEED + 31 * (rep + 1)));
    const high = (i: number) => levels.get(ps[i]!.id) === 'high';
    let inc: (i: number) => boolean = () => true;
    if (thin) {
      const rnd = mulberry32(SYN_SEED + 7919 * (rep + 1));
      const sample = (ids: number[], n: number) => ids.map((i) => ({ i, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.i);
      const chosen = new Set([...sample(ps.map((_p, i) => i).filter((i) => !isFaked[i]), thin.base), ...sample(ps.map((_p, i) => i).filter((i) => isFaked[i]), thin.faked)]);
      inc = (i) => chosen.has(i);
    }
    // Снятие понижения созвоном: свой жребий на повтор и вариант (только у вариантов с lift).
    const lifted = VARIANTS.map((vr, k) => {
      const set = new Set<number>();
      if (!vr.lift) return set;
      const rnd = mulberry32(SYN_SEED + 131 * (rep + 1) + 7 * k);
      ps.forEach((_p, i) => { const a = rnd(), b = rnd(); if (high(i) && a < vr.lift!.share && b < (isFaked[i] ? vr.lift!.cheat : vr.lift!.honest)) set.add(i); });
      return set;
    });
    const honestHigh = ps.map((_p, i) => i).filter((i) => inc(i) && high(i) && !isFaked[i]);
    honestHighN += honestHigh.length;
    honestCatN += ps.filter((p, i) => inc(i) && p.category && !isFaked[i]).length;
    ps.forEach((_p, i) => { if (inc(i) && isFaked[i]) { fakedSeen++; if (high(i)) fakedHigh++; } });
    const v1Top10 = queries.map(() => new Set<string>());
    queries.forEach((q, qi) => {
      const rel: Record<string, number> = thin ? Object.fromEntries(Object.entries(q.rel).filter(([id]) => inc(idx.get(id)!))) : q.rel;
      VARIANTS.forEach((vr, k) => {
        const ids = order(q, k, (i) => high(i) && !lifted[k]!.has(i), inc);
        // Сверка быстрого пути с боевым rankCandidates на первом повторе.
        if (rep === 0) {
          const ev = ps.map((p, i) => [p, i] as const).filter(([, i]) => inc(i)).map(([p, i]) => toEvidence(p, levels.get(p.id), lifted[k]!.has(i)));
          const ranked = rankCandidates(ev, q.target, catalog, q.filters, vr.opts);
          const ref = (q.requireCoverage ? dropUncovered(ranked) : ranked).map((r) => r.candidateId);
          if (ref.join() !== ids.join()) throw new Error(`быстрый путь расходится с rankCandidates: ${q.id} ${vr.name}`);
        }
        const s = sums[k]![qi]!;
        s.p5 += precisionAtK(ids, rel, 5); s.p10 += precisionAtK(ids, rel, 10); s.ndcg10 += ndcgAtK(ids, rel, 10); s.mrr += reciprocalRank(ids, rel);
        f5[k]! += ids.slice(0, 5).filter((id) => isFaked[idx.get(id)!]).length;
        f10[k]! += ids.slice(0, 10).filter((id) => isFaked[idx.get(id)!]).length;
        listed[k]! += ids.filter((id) => isFaked[idx.get(id)!]).length;
        const top10 = new Set(ids.slice(0, 10));
        if (k === 0) v1Top10[qi] = top10;
        for (const i of honestHigh) {
          const id = ps[i]!.id;
          if (!v1Top10[qi]!.has(id)) continue;
          hh[k]!.top10SlotsV1++;
          if (!top10.has(id)) { hh[k]!.lostTop10Slots++; if ((rel[id] ?? 0) > 0) hh[k]!.lostRelevantTop10Slots++; }
        }
      });
    });
    for (const i of honestHigh) {
      const inAny = v1Top10.some((s) => s.has(ps[i]!.id));
      hh.forEach((h) => { h.events++; if (inAny) h.inTop10V1++; });
    }
  }
  const perQ = (k: number, m: MetricName) => sums[k]!.map((s) => s[m] / REPS);
  const variants: Record<string, VariantStats> = {};
  VARIANTS.forEach((vr, k) => {
    const metrics = {} as Record<MetricName, Interval>;
    const deltaVsV1 = {} as Record<MetricName, Interval>;
    METRICS.forEach((m, mi) => {
      metrics[m] = bootstrapMean(perQ(k, m), BOOT_REPS, SYN_SEED + 17 * k + mi);
      deltaVsV1[m] = bootstrapDiff(perQ(k, m), perQ(0, m), BOOT_REPS, SYN_SEED + 900 + mi);
    });
    const slots = (n: number) => n * queries.length * REPS;
    variants[vr.name] = { metrics, deltaVsV1, fakedShareTop5: f5[k]! / slots(5), fakedShareTop10: f10[k]! / slots(10), fakedListed: listed[k]! / (queries.length * REPS), honestHigh: hh[k]! };
  });
  return {
    queries: queries.length,
    observed: { fakedHighShare: fakedSeen ? fakedHigh / fakedSeen : null, honestHighShare: honestCatN ? honestHighN / honestCatN : 0 },
    variants,
  };
}

/** Цена одного ложного high (детерминированно, полный пул): каждый честный с категорией по очереди — единственный с high. */
function costPerFalseHigh(set: SynSet, queries: Query[]) {
  const ps = set.profiles;
  const honest = ps.map((p, i) => (p.category && p.archetype !== 'category_faked' ? i : -1)).filter((i) => i >= 0);
  const top = (q: Query, k: number, flag: number) => {
    const out: RankedCandidate[] = [];
    ps.forEach((_p, i) => { const r = i === flag && k > 0 ? q.flagged[k]![i] : q.normal[i]; if (r && r.score > 0) out.push(r); });
    out.sort(compareRanked);
    return new Set((q.requireCoverage ? dropUncovered(out) : out).slice(0, 10).map((r) => r.candidateId));
  };
  const base = queries.map((q) => top(q, 0, -1));
  return Object.fromEntries(VARIANTS.slice(1).filter((vr) => !vr.lift).map((vr) => {
    const k = VARIANTS.indexOf(vr);
    let inTop10 = 0, slots = 0, relSlots = 0, lost = 0, lostRel = 0;
    for (const i of honest) {
      const id = ps[i]!.id;
      let any = false;
      queries.forEach((q, qi) => {
        if (!base[qi]!.has(id)) return;
        any = true; slots++;
        const rel = (q.rel[id] ?? 0) > 0;
        if (rel) relSlots++;
        if (!top(q, k, i).has(id)) { lost++; if (rel) lostRel++; }
      });
      if (any) inTop10++;
    }
    return [vr.name, { honestWithCategory: honest.length, inSomeTop10V1: inTop10, top10SlotsV1: slots, relevantTop10SlotsV1: relSlots, lostTop10Slots: lost, lostRelevantTop10Slots: lostRel }];
  }));
}

function runScenario(sc: Scenario) {
  const fakedCount = Math.round((sc.fakedShare * BASE_PROFILES) / (1 - sc.fakedShare));
  const set = generateSynthetic(SYN_SEED, { faked: { count: fakedCount } });
  let rates = integrityRatesFromSimulation(simulation, sc.trapP);
  if (sc.honestHigh) rates = withHonestHigh(rates, sc.honestHigh);
  const vac = buildQueries(set, 'vacancy');
  const bank = buildQueries(set, 'bank');
  const thinFaked = Math.round(THIN_POOL * sc.fakedShare);
  const thin = { base: THIN_POOL - thinFaked, faked: thinFaked };
  return {
    scenario: sc, profiles: set.profiles.length, fakedProfiles: fakedCount, reps: REPS,
    vacancy: evaluate(set, vac, rates, null),
    vacancyThin: { poolSize: THIN_POOL, ...evaluate(set, vac, rates, thin) },
    bank: evaluate(set, bank, rates, null),
    bankThin: { poolSize: THIN_POOL, ...evaluate(set, bank, rates, thin) },
    ...(sc.id === 'main' ? { costPerFalseHigh: { vacancy: costPerFalseHigh(set, vac), bank: costPerFalseHigh(set, bank) } } : {}),
  };
}

// Малый набор: индекса нет ни у кого (демо-профили без попыток) — проверяем, что любой вариант даёт тот же порядок.
const legacyEv: CandidateEvidence[] = [...DEMO_POOL, ...EXTRA_PROFILES].map((p) => ({
  id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
}));
const legacySame = VARIANTS.every((vr) => DEMO_VACANCIES.every((v) => {
  const t: MatchTarget = { specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: [] };
  return dropUncovered(rankCandidates(legacyEv, t, catalog, { expandPool: true }, vr.opts)).map((r) => r.candidateId).join() === dropUncovered(rankCandidates(legacyEv, t, catalog, { expandPool: true })).map((r) => r.candidateId).join();
}));

const f = (x: number) => x.toFixed(3);
const fi = (i: Interval) => `${f(i.mean)} [${f(i.lo)}; ${f(i.hi)}]`;
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
type Block = ReturnType<typeof evaluate>;
function printBlock(title: string, b: Block, full: boolean) {
  console.log(`  -- ${title}: ${b.queries} запросов; high у списанных ${b.observed.fakedHighShare === null ? '-' : pct(b.observed.fakedHighShare)}, у честных с категорией ${pct(b.observed.honestHighShare)}`);
  for (const vr of VARIANTS) {
    const s = b.variants[vr.name]!;
    const h = s.honestHigh;
    const cols = full ? METRICS.map((m) => `${m} ${fi(s.metrics[m])}`).join('  ') : `ndcg10 ${fi(s.metrics.ndcg10)}  p10 ${fi(s.metrics.p10)}`;
    console.log(`  ${vr.label.padEnd(30)} ${cols} | Δndcg10 ${fi(s.deltaVsV1.ndcg10)} Δp10 ${fi(s.deltaVsV1.p10)}${full ? ` Δp5 ${fi(s.deltaVsV1.p5)} Δmrr ${fi(s.deltaVsV1.mrr)}` : ''} | списанных топ-5 ${pct(s.fakedShareTop5)}, топ-10 ${pct(s.fakedShareTop10)}, в выдаче ${s.fakedListed.toFixed(2)} | честн. high: ${h.events} соб., в топ-10 ${h.inTop10V1}, мест ${h.top10SlotsV1}, потеряно ${h.lostTop10Slots} (рел. ${h.lostRelevantTop10Slots})`);
  }
}
const out = SCENARIOS.map(runScenario);
console.log(`Малый набор (17 × 8): порядок при всех вариантах ${legacySame ? 'совпадает' : 'РАЗЛИЧАЕТСЯ'} (индекса у демо-профилей нет).`);
for (const r of out) {
  const full = r.scenario.id === 'main';
  console.log(`\n=== ${r.scenario.label}: ${r.profiles} профилей (списанных ${r.fakedProfiles}), ${REPS} повторов`);
  printBlock('подборка под вакансию, полный пул', r.vacancy, full);
  printBlock(`подборка под вакансию, пул ${THIN_POOL}`, r.vacancyThin, full);
  printBlock('банк с фильтром категории, полный пул', r.bank, full);
  printBlock(`банк с фильтром категории, пул ${THIN_POOL}`, r.bankThin, full);
  if (r.costPerFalseHigh) {
    console.log('  цена одного ложного high (каждый честный с категорией по очереди): честных / в топ-10 при 1 / мест в топ-10 (релевантных) / потеряно (релевантных)');
    for (const [mode, c] of Object.entries(r.costPerFalseHigh)) for (const [v, x] of Object.entries(c)) console.log(`    ${mode.padEnd(8)} ${v.padEnd(9)} ${x.honestWithCategory} / ${x.inSomeTop10V1} / ${x.top10SlotsV1} (${x.relevantTop10SlotsV1}) / ${x.lostTop10Slots} (${x.lostRelevantTop10Slots})`);
  }
}

if (!process.argv.includes('--no-write')) {
  const path = join(here, 'results.json');
  const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  prev[CALL_MODE ? 'integrityRankingCall' : 'integrityRanking'] = {
    note: 'Индекс честности в подборе (11.10): вариант 1 — только метка; 2a — при high категория из теста не учитывается; 2b — балл × factor. Уровни индекса — жребий по долям симуляции теста (eval/test/integrity-results.json, персоны, не люди); reps повторов жребия (и подвыборки для пула 60), метрики по запросу усреднены по повторам, интервалы — бутстреп по запросам, 1000 повторов, 95 %. Банк: разметка «категория фильтра и латентный грейд не ниже» (2), иначе 0. Скрипт eval/matching/integrity.ts.',
    ...(CALL_MODE ? { callNote: 'Режим --call: 2a + снятие понижения созвоном «объяснил сам»; доля созвона и доли «объяснил сам» у честных/списавших — допущения (не измерены).' } : {}),
    seed: SYN_SEED, reps: REPS, thinPool: THIN_POOL, legacySmallSetUnchanged: legacySame, scenarios: out,
  };
  writeFileSync(path, `${JSON.stringify(prev, null, 2)}\n`);
  console.log(`\nзаписано: eval/matching/results.json (ключ ${CALL_MODE ? 'integrityRankingCall' : 'integrityRanking'})`);
}
