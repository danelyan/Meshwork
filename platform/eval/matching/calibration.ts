// Калибровка балла подбора: балл формулы (ranking.ts, scoreCandidate) → вероятность «кандидат подходит».
//   npx tsx eval/matching/calibration.ts [--no-write]     # таблица + ключ calibration в eval/matching/results.json
// Без БД и сети. Разметка – СИНТЕТИЧЕСКАЯ (скрытая истина генератора, synthetic.ts), не исходы реальных приглашений:
// таблица честно калибрует балл против этой разметки; реальные исходы – outcomes.ts.
// Пары: все (вакансия, профиль), которые видит работодатель (rankCandidates + dropUncovered, как в кабинете).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { dropUncovered, rankCandidates, type CandidateEvidence } from '../../src/server/employer/ranking';

import { applyKnots, brier, calibrationCurve, clip01, isotonicFit, metricsOf, type Knot, type Pair } from './calib-math';
import { generateSynthetic, SYN_SEED } from './synthetic';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const syn = generateSynthetic(SYN_SEED);
const evidence: CandidateEvidence[] = syn.profiles.map((p) => ({
  id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
}));

const rel: Pair[] = []; // y = релевантен >= 1
const strong: Pair[] = []; // y = сильный (2)
let allPairs = 0;
for (const v of syn.vacancies) {
  const r = syn.relevance[v.id] ?? {};
  const ranked = dropUncovered(rankCandidates(evidence, {
    specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: v.stack,
  }, catalog));
  allPairs += evidence.length;
  for (const x of ranked) {
    rel.push({ score: x.score, y: (r[x.candidateId] ?? 0) >= 1 ? 1 : 0, vacancy: v.id });
    strong.push({ score: x.score, y: (r[x.candidateId] ?? 0) >= 2 ? 1 : 0, vacancy: v.id });
  }
}

const maxScore = Math.max(...rel.map((p) => p.score));
const ys = (ps: Pair[]) => ps.map((p) => p.y);
const raw = (ps: Pair[]) => ps.map((p) => clip01(p.score));

// половины: чётные / нечётные вакансии (по порядку в наборе)
const order = syn.vacancies.map((v) => v.id);
const half = (ps: Pair[], h: 0 | 1) => ps.filter((p) => order.indexOf(p.vacancy) % 2 === h);
function holdout(ps: Pair[]) {
  const folds = ([0, 1] as const).map((h) => {
    const train = half(ps, h), test = half(ps, (1 - h) as 0 | 1);
    const knots = isotonicFit(train);
    const before = brier(raw(test), ys(test));
    const after = brier(test.map((p) => applyKnots(knots, p.score)), ys(test));
    return { trainVacancies: new Set(train.map((p) => p.vacancy)).size, testPairs: test.length, brierBefore: before, brierAfter: after };
  });
  const n = folds.reduce((s, f) => s + f.testPairs, 0);
  const w = (k: 'brierBefore' | 'brierAfter') => folds.reduce((s, f) => s + f[k] * f.testPairs, 0) / n;
  return { folds, brierBefore: w('brierBefore'), brierAfter: w('brierAfter') };
}

function block(ps: Pair[]) {
  const knots: Knot[] = isotonicFit(ps);
  const before = raw(ps), after = ps.map((p) => applyKnots(knots, p.score));
  return {
    pairs: ps.length, positives: ps.filter((p) => p.y).length, base: ps.filter((p) => p.y).length / ps.length,
    before: metricsOf(before, ys(ps)), afterInSample: metricsOf(after, ys(ps)),
    curveBefore: calibrationCurve(before, ys(ps)), curveAfter: calibrationCurve(after, ys(ps)),
    holdout: holdout(ps), knots,
  };
}

const relevant = block(rel);
const strongBlock = block(strong);
const result = {
  note: 'Калибровка на СИНТЕТИЧЕСКОЙ разметке (скрытая истина генератора, eval/matching/synthetic.ts), не на исходах реальных приглашений. Брир «до» – сам балл формулы, обрезанный в [0;1], как вероятность. Проверка: калибровка на чётных вакансиях – оценка на нечётных, и наоборот. Пары – те, что видит работодатель (после dropUncovered).',
  profiles: syn.profiles.length, vacancies: syn.vacancies.length, pairsTotal: allPairs, pairsShown: rel.length, maxScore,
  relevant, strong: strongBlock,
};

const f = (x: number | null, d = 3) => (x === null ? '  - ' : x.toFixed(d));
for (const [name, b] of [['релевантен >= 1', relevant], ['сильный = 2', strongBlock]] as const) {
  console.log(`\n== ${name}: ${b.pairs} пар, положительных ${b.positives} (${(b.base * 100).toFixed(1)} %), макс. балл ${maxScore.toFixed(2)}`);
  console.log(`до:    Brier ${f(b.before.brier)}  log-loss ${f(b.before.logLoss)}  ECE ${f(b.before.ece)}`);
  console.log(`после (на всех): Brier ${f(b.afterInSample.brier)}  log-loss ${f(b.afterInSample.logLoss)}  ECE ${f(b.afterInSample.ece)}`);
  console.log(`кросс-проверка по половинам вакансий: Brier ${f(b.holdout.brierBefore)} -> ${f(b.holdout.brierAfter)}`);
  console.log('бин        средний балл  доля  n');
  for (const c of b.curveBefore) console.log(`${c.lo.toFixed(1)}-${c.hi.toFixed(1)}   ${f(c.meanScore)}        ${f(c.share)}  ${c.n}`);
  console.log('узлы:', b.knots.map((k) => `[${k.x}, ${k.p}]`).join(' '));
}

if (!process.argv.includes('--no-write')) {
  const path = join(here, 'results.json');
  const cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...cur, calibration: result }, null, 2)}\n`);
  console.log('\nзаписано: eval/matching/results.json (ключ calibration)');
}
