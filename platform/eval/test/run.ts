// Валидация теста на грейд на синтетических кандидатах (ADR-0002 § валидация), без LLM и без БД.
// Тот же движок, что в проде: пул подкатегории poolFor, старт START_THETA, selectNext по пулу фазы (phasePool),
// nextStep (основная фаза + дозадавание), decide; параметры шаблонов из кода (экспертные).
//
// Две постановки метрик, обе считаются в одном прогоне на одних и тех же правилах:
//   strict      – НАША строгая: истина – метка популяции («Junior сдаёт Junior»), популяции пересекаются и
//                 заходят за пороги, решение – бинарное «подтверждён / нет», κ Коэна по бинарному решению.
//   competitor  – НОРМАЛЬНАЯ ПОПУЛЯЦИЯ: θ ~ N(0; 1),
//                 истина – θ_true выше порога заявленного грейда; грейд – 4 класса (ниже Junior / J / M / S) по
//                 старшему порогу с P(θ > порог) ≥ 0,5; взвешенный (квадратичный) κ; AUC по полосам истинной θ.
//                 Заявка: истинный грейд в 50 %, на грейд выше / ниже – по 25 %.
// Ошибка параметров задания в генераторе ответов (ответы порождает 2PL, оценщик видит экспертные a, b):
//   instance – b_экз = b + N(0; σ) на КАЖДЫЙ показ (σ = --noise, по умолчанию 0,2; наша прежняя модель);
//   family   – b + N(0; 0,3), ln a + N(0; 0,15), фиксированные на семейство на весь прогон.
// По умолчанию считаются обе модели ошибки; --error instance|family – одна.
//
// Запуск из platform/:
//   npx tsx eval/test/run.ts                                   # все подкатегории, N = 600 на подкатегорию, обе постановки
//   npx tsx eval/test/run.ts --n 2000 --json eval/test/results.json
//   npx tsx eval/test/run.ts --spec ai --sub ai.mlops --rules v4    # прежние правила остановки (adr-0002-v4)
//   npx tsx eval/test/run.ts --population legacy               # старая популяция строгой постановки
//   npx tsx eval/test/run.ts --no-probe --min 7 --max 12 --se-stop none   # эксперименты с остановкой
//
// Честная граница: симуляция проверяет свойства механики ПРИ ЗАДАННЫХ параметрах заданий (a, b экспертные,
// на людях не оценены), а не то, что задания измеряют умение. Ответы порождает логистическая модель той же
// формы, что и оценщик (замкнутая проверка). Разомкнутая – персоны: eval/test/subcategory-personas.ts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { SUBCATEGORIES } from '../../src/lib/directions';
import { GRADES, type Grade } from '../../src/lib/grades';
import { GENERATORS, generatorsFor, poolFor } from '../../src/server/test/generators';
import { estimateTheta, probAbove, probCorrect, type Response } from '../../src/server/test/irt';
import {
  CONFIRM_PROB,
  decide,
  GRADE_CUT,
  nextStep,
  phasePool,
  POLICY_VERSION,
  RULES_BY_VERSION,
  selectNext,
  shouldStop,
  START_THETA,
  type AttemptPhase,
  type SelectableTemplate,
  type StopLimits,
} from '../../src/server/test/policy';
import { createRng, deriveSeed, type Rng } from '../../src/server/test/rng';

const args = process.argv.slice(2);
const argStr = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const argNum = (name: string, def: number) => (argStr(name) !== undefined ? Number(argStr(name)) : def);
const N = argNum('n', 600);
const SEED = argNum('seed', 1);
const NOISE = argNum('noise', 0.2);
const FAMILY_B = argNum('family-b', 0.3);
const FAMILY_A = argNum('family-a', 0.15);
const CONFIRM = argNum('confirm', CONFIRM_PROB);
const PROBE = !args.includes('--no-probe');
const SPEC = argStr('spec');
const SUB = argStr('sub');
const JSON_OUT = argStr('json');
const ERRORS = (argStr('error') ? [argStr('error')!] : ['instance', 'family']) as ErrorModel[];
const POPULATION = argStr('population') ?? 'persona';
if (POPULATION !== 'persona' && POPULATION !== 'legacy') throw new Error(`--population: persona | legacy, получено ${POPULATION}`);
const RULES_NAME = argStr('rules') ?? POLICY_VERSION;
const baseRules = RULES_BY_VERSION[RULES_NAME];
if (!baseRules) throw new Error(`--rules: ${Object.keys(RULES_BY_VERSION).join(' | ')}, получено ${RULES_NAME}`);
const seArg = argStr('se-stop');
const RULES: StopLimits = {
  ...baseRules,
  min: argNum('min', baseRules.min),
  max: argNum('max', baseRules.max),
  ...(seArg !== undefined ? { seStop: seArg === 'none' ? null : Number(seArg) } : {}),
  ...(argStr('early') !== undefined ? { earlyStop: Number(argStr('early')) } : {}),
};
/** Эксперимент: --cut-select 0.4 – выбирать задание по информации в точке порога фазы, если |θ̂ − порог| < 0,4 . */
const CUT_SELECT = argNum('cut-select', 0);
/**
 * Пересдача: после попытки кандидат видит разбор и ключи, поэтому в следующей попытке семейства, которые он уже видел,
 * решаются легче: P' = P + LEARN·(1 − P) (модель обучения, по умолчанию 0,3; --learn 0 – без обучения).
 * --no-seen-before – не передавать движку прошлые семейства (как до v5): пересдача снова по тем же семействам.
 */
const LEARN = argNum('learn', 0.3);
const SEEN_BEFORE = !args.includes('--no-seen-before');
/**
 * --retest-only: без утечки и пересдач (leak, retake*, bestOf3 – null). Ретест, точность и длина не меняются: их попытки
 * идут раньше на том же rng. Для перебора лимитов длины (eval/test/length-sweep.ts).
 */
const RETEST_ONLY = args.includes('--retest-only');
if (argStr('junior-cut') !== undefined) GRADE_CUT.junior = Number(argStr('junior-cut'));
/**
 * Эксперимент «что даст пополнение банка»: --virtual "junior:-0.2,-0.1;middle:0,0.2;senior:0.9" добавляет в пул КАЖДОЙ
 * подкатегории виртуальные семейства с указанными b (a = --virtual-a, по умолчанию 1,2; своё утверждение каталога).
 * Только для планирования банка: настоящих заданий за ними нет.
 */
const VIRTUAL: { grade: Grade; b: number }[] = (argStr('virtual') ?? '')
  .split(';')
  .filter(Boolean)
  .flatMap((part) => {
    const [g, bs] = part.split(':');
    return (bs ?? '').split(',').filter(Boolean).map((b) => ({ grade: g as Grade, b: Number(b) }));
  });
const VIRTUAL_A = argNum('virtual-a', 1.2);
/**
 * Чувствительность к допущению об a: --a-override 1.8 ставит всем семействам a = 1,8,
 * для заданий с вводом ответа. И в оценщике, и в генераторе ответов.
 */
const A_OVERRIDE = argStr('a-override') !== undefined ? Number(argStr('a-override')) : null;

type ErrorModel = 'instance' | 'family';
/** Лимит времени шаблона, сек (TaskGenerator.timeLimitSec). */
const TIME_LIMIT = new Map(GENERATORS.map((g) => [g.id, g.timeLimitSec]));
/** Класс грейда: 0 – ниже Junior, 1 – Junior, 2 – Middle, 3 – Senior. */
type GradeClass = 0 | 1 | 2 | 3;
const CUTS = () => [GRADE_CUT.junior, GRADE_CUT.middle, GRADE_CUT.senior];
const classOf = (theta: number): GradeClass => CUTS().filter((c) => theta > c).length as GradeClass;

/** Нормальное распределение (Бокс–Мюллер) на детерминированном rng. */
function gauss(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Популяции строгой постановки [В]: θ_true ~ N(μ, σ) по группе (eval/test/run.ts до 10.10, ADR-0002 «Смена популяции
// синтетики»). legacy – из головы до персон; persona – θ̂ персон под политикой v3 (новичок −0,9, Junior 0,3, Middle 0,8).
// Senior (добавлен с тестом на подкатегорию) – N(1,6; 0,5) в обеих: середина Senior-семейств банка (b 1,0…1,7) +
// запас; персонами не подобран, это допущение.
const POPS: Record<string, Record<'novice' | Grade, { mu: number; sd: number }>> = {
  legacy: { novice: { mu: -2.1, sd: 0.5 }, junior: { mu: -0.8, sd: 0.5 }, middle: { mu: 0.6, sd: 0.5 }, senior: { mu: 1.6, sd: 0.5 } },
  persona: { novice: { mu: -0.9, sd: 0.5 }, junior: { mu: 0.3, sd: 0.4 }, middle: { mu: 0.8, sd: 0.6 }, senior: { mu: 1.6, sd: 0.5 } },
};
const POP = POPS[POPULATION]!;

interface Sim {
  thetaTrue: number;
  claimed: Grade;
  /** Истина решения: должен ли быть подтверждён заявленный грейд. */
  truth: boolean;
  /** Строгая постановка: группа популяции; конкурентная – null. */
  pop: 'novice' | Grade | null;
}

interface Outcome {
  theta: number;
  pPass: number;
  confirmed: boolean;
  offered: boolean;
  /** 4-классный грейд по старшему порогу с P(θ > порог) ≥ 0,5. */
  cls: GradeClass;
  length: number;
  shown: string[];
  probed: boolean;
  /**
   * Ранняя остановка основной фазы: остановилась по уверенности (P ≥ early или ≤ 1 − early) или по SE до лимита max.
   * У заявки Senior основная фаза – 4 Senior-задания (< min), поэтому ранней она не бывает.
   */
  earlyStop: boolean;
  /** Сумма лимитов времени показанных заданий, мин (верхняя граница времени прохождения). */
  minutes: number;
}

/** Параметры ответа: экспертные (что видит оценщик) и «истинные» (чем порождается ответ). */
interface TruePool {
  pool: SelectableTemplate[];
  trueA: Map<string, number>;
  trueB: Map<string, number>;
}

function truePool(pool: SelectableTemplate[], model: ErrorModel, seed: number): TruePool {
  const rng = createRng(seed);
  const trueA = new Map<string, number>();
  const trueB = new Map<string, number>();
  for (const t of pool) {
    trueA.set(t.id, model === 'family' ? t.a * Math.exp(FAMILY_A * gauss(rng)) : t.a);
    trueB.set(t.id, model === 'family' ? t.b + FAMILY_B * gauss(rng) : t.b);
  }
  return { pool, trueA, trueB };
}

/** Один прогон адаптивного теста: тот же цикл, что в service.ts (и subcategory-personas.ts), без БД. */
interface AttemptOpts {
  /** Знание трюка шаблона (утечка): +0,3 к P. */
  trick?: ReadonlySet<string>;
  /** Семейства прошлых попыток кандидата – движку для ротации (если SEEN_BEFORE). */
  seen?: ReadonlySet<string>;
  /** Семейства, по которым кандидат учился на разборе прошлой попытки: P' = P + LEARN·(1 − P). */
  learned?: ReadonlySet<string>;
}

function runAttempt(tp: TruePool, model: ErrorModel, sim: Sim, attemptSeed: number, rng: Rng, opts: AttemptOpts = {}): Outcome {
  const trick = opts.trick ?? new Set<string>();
  const seen = opts.seen ?? new Set<string>();
  const learned = opts.learned ?? new Set<string>();
  const { pool } = tp;
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  let phase: AttemptPhase = 'main';
  let probed = false;
  let mainLength: number | null = null;
  for (let index = 0; index < pool.length; index++) {
    const theta = responses.length ? estimateTheta(responses).theta : START_THETA[sim.claimed];
    const cut = GRADE_CUT[phase === 'junior_probe' ? 'junior' : phase === 'middle_probe' ? 'middle' : sim.claimed];
    const selTheta = CUT_SELECT > 0 && responses.length > 0 && Math.abs(theta - cut) < CUT_SELECT ? cut : theta;
    const next = selectNext(phasePool(pool, phase, sim.claimed), {
      shown,
      theta: selTheta,
      seed: deriveSeed(attemptSeed, 1000 + index),
      ...(SEEN_BEFORE && seen.size ? { seenBefore: seen } : {}),
    });
    if (!next) break;
    shown.push(next);
    const b = tp.trueB.get(next.id)! + (model === 'instance' ? NOISE * gauss(rng) : 0);
    let p = probCorrect(sim.thetaTrue, { a: tp.trueA.get(next.id)!, b });
    // Утечка: знание трюка шаблона (+0,3 к P), не конкретного экземпляра.
    if (trick.has(next.id)) p = Math.min(1, p + 0.3);
    if (learned.has(next.id)) p += LEARN * (1 - p);
    responses.push({ a: next.a, b: next.b, correct: rng.next() < p });
    if (!PROBE) {
      if (shouldStop(responses.length, estimateTheta(responses), sim.claimed, shown.length >= pool.length, RULES).stop) {
        mainLength = responses.length;
        break;
      }
      continue;
    }
    const step = nextStep({ pool, shown, responses, grade: sim.claimed }, RULES);
    if (step.phase !== 'main') probed = true;
    if (mainLength === null && step.mainLength !== null) mainLength = step.mainLength;
    if (step.stop) break;
    phase = step.phase;
  }
  const d = decide(responses, sim.claimed, CONFIRM);
  const est = estimateTheta(responses);
  const cls = CUTS().filter((c) => probAbove(est, c) >= 0.5).length as GradeClass;
  const minutes = shown.reduce((m, t) => m + (TIME_LIMIT.get(t.id) ?? 180), 0) / 60;
  // Причина остановки основной фазы – повтор shouldStop без исчерпания пула: 'confident' | 'precise' – ранняя.
  const ml = mainLength ?? responses.length;
  const mainReason = ml > 0 ? shouldStop(ml, estimateTheta(responses.slice(0, ml)), sim.claimed, false, RULES).reason : null;
  const earlyStop = ml < RULES.max && (mainReason === 'confident' || mainReason === 'precise');
  return { theta: d.theta, pPass: d.pPass, confirmed: d.confirmed, offered: d.juniorOffered, cls, length: responses.length, shown: shown.map((s) => s.id), probed, earlyStop, minutes };
}

// --- метрики ---------------------------------------------------------------------------------------------

function auc(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return pos.length && neg.length ? wins / (pos.length * neg.length) : NaN;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** κ Коэна для k классов; weighted – квадратичные веса (κw). Бинарный случай – k = 2. */
function kappa(a: number[], b: number[], k: number, weighted = false): number {
  const n = a.length;
  const obs = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const ra = new Array<number>(k).fill(0);
  const rb = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    obs[a[i]!]![b[i]!]! += 1 / n;
    ra[a[i]!]! += 1 / n;
    rb[b[i]!]! += 1 / n;
  }
  let po = 0;
  let pe = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = weighted ? 1 - ((i - j) / (k - 1)) ** 2 : i === j ? 1 : 0;
      po += w * obs[i]![j]!;
      pe += w * ra[i]! * rb[j]!;
    }
  }
  return pe >= 1 ? 1 : (po - pe) / (1 - pe);
}

const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/** Полосы расстояния |θ_true − порог заявленного| . */
const DIST_BANDS: [number, number][] = [
  [0, 0.1],
  [0.1, 0.3],
  [0.3, 0.5],
  [0.5, Infinity],
];

interface CommonMetrics {
  n: number;
  /** Точность бинарного решения против истины постановки. */
  accuracy: number | null;
  falsePass: number | null;
  falseFail: number | null;
  byClaim: Record<Grade, { n: number; accuracy: number | null; falsePass: number | null; falseFail: number | null }>;
  byDistance: { from: number; to: number | null; n: number; accuracy: number | null }[];
  retest: { decisionAgreement: number | null; kappaBinary: number | null; rTheta: number | null; familyOverlap: number | null };
  rThetaTrue: number | null;
  length: { mean: number | null; p10: number | null; p90: number | null; byClaim: Record<Grade, number | null> };
  /** Сумма лимитов времени показанных заданий, мин: среднее и 90-й перцентиль. */
  minutes: { mean: number | null; p90: number | null };
  probedShare: number | null;
  /** Доля попыток, где основная фаза остановилась рано (по уверенности или SE до max); все заявки, включая Senior. */
  earlyStopShare: number | null;
  maxExposure: number | null;
}

function common(sims: Sim[], first: Outcome[], second: Outcome[], pool: SelectableTemplate[]): CommonMetrics {
  const idx = sims.map((_, i) => i);
  const acc = (ii: number[]) => r3(share(ii.map((i) => first[i]!.confirmed === sims[i]!.truth)));
  const fp = (ii: number[]) => r3(share(ii.filter((i) => !sims[i]!.truth).map((i) => first[i]!.confirmed)));
  const fn = (ii: number[]) => r3(share(ii.filter((i) => sims[i]!.truth).map((i) => !first[i]!.confirmed)));
  const byClaim = Object.fromEntries(
    GRADES.map((g) => {
      const ii = idx.filter((i) => sims[i]!.claimed === g);
      return [g, { n: ii.length, accuracy: acc(ii), falsePass: fp(ii), falseFail: fn(ii) }];
    }),
  ) as CommonMetrics['byClaim'];
  const dist = (i: number) => Math.abs(sims[i]!.thetaTrue - GRADE_CUT[sims[i]!.claimed]);
  const exposure = pool.map((t) => share(first.map((o) => o.shown.includes(t.id))));
  return {
    n: sims.length,
    accuracy: acc(idx),
    falsePass: fp(idx),
    falseFail: fn(idx),
    byClaim,
    byDistance: DIST_BANDS.map(([lo, hi]) => {
      const ii = idx.filter((i) => dist(i) >= lo && dist(i) < hi);
      return { from: lo, to: Number.isFinite(hi) ? hi : null, n: ii.length, accuracy: acc(ii) };
    }),
    retest: {
      decisionAgreement: r3(share(idx.map((i) => first[i]!.confirmed === second[i]!.confirmed))),
      kappaBinary: r3(kappa(first.map((o) => +o.confirmed), second.map((o) => +o.confirmed), 2)),
      rTheta: r3(pearson(first.map((o) => o.theta), second.map((o) => o.theta))),
      familyOverlap: r3(mean(first.map((o, i) => o.shown.filter((id) => second[i]!.shown.includes(id)).length / o.shown.length))),
    },
    rThetaTrue: r3(pearson(first.map((o) => o.theta), sims.map((s) => s.thetaTrue))),
    length: {
      mean: r3(mean(first.map((o) => o.length))),
      p10: quantile(first.map((o) => o.length), 0.1),
      p90: quantile(first.map((o) => o.length), 0.9),
      byClaim: Object.fromEntries(GRADES.map((g) => [g, r3(mean(idx.filter((i) => sims[i]!.claimed === g).map((i) => first[i]!.length)))])) as Record<Grade, number | null>,
    },
    minutes: { mean: r3(mean(first.map((o) => o.minutes))), p90: r3(quantile(first.map((o) => o.minutes), 0.9)) },
    probedShare: r3(share(first.map((o) => o.probed))),
    earlyStopShare: r3(share(first.map((o) => o.earlyStop))),
    maxExposure: r3(Math.max(...exposure)),
  };
}

interface StrictMetrics extends CommonMetrics {
  /** AUC θ̂ соседних популяций (пересекаются: потолок ниже 1). */
  auc: { juniorVsNovice: number | null; middleVsJunior: number | null; seniorVsMiddle: number | null };
  /** Junior заявил Middle: ложный Middle и «Junior в 1 клик». */
  juniorClaimsMiddle: { falseMiddle: number | null; offeredJunior: number | null };
  leak: { falsePass: number | null; baseline: number | null };
  /** Лучшая из 3 попыток (2-я и 3-я – с обучением по разбору) у тех, кто ниже заявленного: ложное подтверждение. */
  bestOf3FalsePass: number | null;
  /** 2-я попытка с обучением по разбору 1-й: ложное подтверждение и доля семейств, повторённых из 1-й. */
  retakeFalsePass: number | null;
  retakeOverlap: number | null;
}

interface CompetitorMetrics extends CommonMetrics {
  grade4: {
    exact: number | null;
    within1: number | null;
    kappa: number | null;
    kappaWeighted: number | null;
    retestAgreement: number | null;
    retestKappa: number | null;
    retestKappaWeighted: number | null;
  };
  /** AUC θ̂ соседних грейдов по полосам истинной θ (потолок 1). */
  aucByBand: { juniorVsBelow: number | null; middleVsJunior: number | null; seniorVsMiddle: number | null };
}

// --- сценарии ----------------------------------------------------------------------------------------------

/** Строгая постановка: 6 сценариев поровну; истина – метка популяции. */
function strictSims(rng: Rng): Sim[] {
  const scen: ['novice' | Grade, Grade][] = [
    ['novice', 'junior'],
    ['junior', 'junior'],
    ['junior', 'middle'],
    ['middle', 'middle'],
    ['middle', 'senior'],
    ['senior', 'senior'],
  ];
  const rank = { novice: 0, junior: 1, middle: 2, senior: 3 } as const;
  return Array.from({ length: N }, (_, i) => {
    const [pop, claimed] = scen[i % scen.length]!;
    return { thetaTrue: POP[pop].mu + POP[pop].sd * gauss(rng), claimed, truth: rank[pop] >= rank[claimed], pop };
  });
}

/** Нормальная популяция: θ ~ N(0; 1), заявка – истинный грейд ±1; истина – θ выше порога заявленного. */
function competitorSims(rng: Rng): Sim[] {
  return Array.from({ length: N }, () => {
    const thetaTrue = gauss(rng);
    const cls = classOf(thetaTrue);
    const u = rng.next();
    const shift = u < 0.5 ? 0 : u < 0.75 ? 1 : -1;
    const claimed = GRADES[Math.min(2, Math.max(0, cls - 1 + shift))]!;
    return { thetaTrue, claimed, truth: thetaTrue > GRADE_CUT[claimed], pop: null };
  });
}

function runStrict(tp: TruePool, model: ErrorModel, subIndex: number): StrictMetrics {
  const rng = createRng(SEED * 7919 + subIndex * 101 + 1);
  const sims = strictSims(rng);
  const first = sims.map((s, i) => runAttempt(tp, model, s, deriveSeed(SEED, i), rng));
  const second = sims.map((s, i) => runAttempt(tp, model, s, deriveSeed(SEED + 100_000, i), rng, { seen: new Set(first[i]!.shown) }));
  const base = common(sims, first, second, tp.pool);
  const thetaOf = (pop: Sim['pop']) => first.filter((_, i) => sims[i]!.pop === pop).map((o) => o.theta);
  const jcmIdx = sims.map((_, i) => i).filter((i) => sims[i]!.pop === 'junior' && sims[i]!.claimed === 'middle');
  const below = sims.map((_, i) => i).filter((i) => !sims[i]!.truth);
  if (RETEST_ONLY) {
    return {
      ...base,
      auc: {
        juniorVsNovice: r3(auc(thetaOf('junior'), thetaOf('novice'))),
        middleVsJunior: r3(auc(thetaOf('middle'), thetaOf('junior'))),
        seniorVsMiddle: r3(auc(thetaOf('senior'), thetaOf('middle'))),
      },
      juniorClaimsMiddle: { falseMiddle: r3(share(jcmIdx.map((i) => first[i]!.confirmed))), offeredJunior: r3(share(jcmIdx.map((i) => first[i]!.offered))) },
      leak: { falsePass: null, baseline: base.falsePass },
      bestOf3FalsePass: null,
      retakeFalsePass: null,
      retakeOverlap: null,
    };
  }
  const trick = new Set(createRng(SEED + 5 + subIndex).sample(tp.pool.map((p) => p.id), Math.round(tp.pool.length * 0.3)));
  const leaked = below.map((i) => runAttempt(tp, model, sims[i]!, deriveSeed(SEED + 300_000, i), rng, { trick }));
  // Пересдачи ниже порога: 2-я и 3-я попытки с обучением по разбору прошлых (LEARN) и ротацией семейств (SEEN_BEFORE).
  const retake2 = below.map((i) => runAttempt(tp, model, sims[i]!, deriveSeed(SEED + 400_000, i), rng, { seen: new Set(first[i]!.shown), learned: new Set(first[i]!.shown) }));
  const retake3 = below.map((i, k) => {
    const prev = new Set([...first[i]!.shown, ...retake2[k]!.shown]);
    return runAttempt(tp, model, sims[i]!, deriveSeed(SEED + 450_000, i), rng, { seen: prev, learned: prev });
  });
  return {
    ...base,
    auc: {
      juniorVsNovice: r3(auc(thetaOf('junior'), thetaOf('novice'))),
      middleVsJunior: r3(auc(thetaOf('middle'), thetaOf('junior'))),
      seniorVsMiddle: r3(auc(thetaOf('senior'), thetaOf('middle'))),
    },
    juniorClaimsMiddle: { falseMiddle: r3(share(jcmIdx.map((i) => first[i]!.confirmed))), offeredJunior: r3(share(jcmIdx.map((i) => first[i]!.offered))) },
    leak: { falsePass: r3(share(leaked.map((o) => o.confirmed))), baseline: base.falsePass },
    bestOf3FalsePass: r3(share(below.map((i, k) => first[i]!.confirmed || retake2[k]!.confirmed || retake3[k]!.confirmed))),
    retakeFalsePass: r3(share(retake2.map((o) => o.confirmed))),
    retakeOverlap: r3(mean(below.map((i, k) => retake2[k]!.shown.filter((id) => first[i]!.shown.includes(id)).length / retake2[k]!.shown.length))),
  };
}

function runCompetitor(tp: TruePool, model: ErrorModel, subIndex: number): CompetitorMetrics {
  const rng = createRng(SEED * 104729 + subIndex * 101 + 2);
  const sims = competitorSims(rng);
  const first = sims.map((s, i) => runAttempt(tp, model, s, deriveSeed(SEED + 500_000, i), rng));
  const second = sims.map((s, i) => runAttempt(tp, model, s, deriveSeed(SEED + 600_000, i), rng, { seen: new Set(first[i]!.shown) }));
  const base = common(sims, first, second, tp.pool);
  const trueCls = sims.map((s) => classOf(s.thetaTrue));
  const est1 = first.map((o) => o.cls);
  const est2 = second.map((o) => o.cls);
  const thetaOfCls = (c: GradeClass) => first.filter((_, i) => trueCls[i] === c).map((o) => o.theta);
  return {
    ...base,
    grade4: {
      exact: r3(share(est1.map((c, i) => c === trueCls[i]))),
      within1: r3(share(est1.map((c, i) => Math.abs(c - trueCls[i]!) <= 1))),
      kappa: r3(kappa(trueCls, est1, 4)),
      kappaWeighted: r3(kappa(trueCls, est1, 4, true)),
      retestAgreement: r3(share(est1.map((c, i) => c === est2[i]))),
      retestKappa: r3(kappa(est1, est2, 4)),
      retestKappaWeighted: r3(kappa(est1, est2, 4, true)),
    },
    aucByBand: {
      juniorVsBelow: r3(auc(thetaOfCls(1), thetaOfCls(0))),
      middleVsJunior: r3(auc(thetaOfCls(2), thetaOfCls(1))),
      seniorVsMiddle: r3(auc(thetaOfCls(3), thetaOfCls(2))),
    },
  };
}

// --- прогон -----------------------------------------------------------------------------------------------

interface SubReport {
  subcategoryId: string;
  title: string;
  families: Record<Grade, number>;
  byError: Record<string, { strict: StrictMetrics; competitor: CompetitorMetrics }>;
}

const t0 = Date.now();
const subs = SUBCATEGORIES.filter((s) => (!SPEC || s.specialization === SPEC) && (!SUB || s.id === SUB));
const reports: SubReport[] = [];
for (const sub of subs) {
  const tpRaw = poolFor(sub.specialization, sub.id);
  if (!tpRaw || tpRaw.legacy) continue;
  const subIndex = SUBCATEGORIES.indexOf(sub);
  // --pool spec – эксперимент «общие компетенции»: пул попытки – все семейства направления, а не подкатегории.
  const gens = argStr('pool') === 'spec' ? generatorsFor(sub.specialization) : tpRaw.generators;
  const pool: SelectableTemplate[] = gens.map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
  if (A_OVERRIDE !== null) for (const t of pool) t.a = A_OVERRIDE;
  VIRTUAL.forEach((v, k) => pool.push({ id: `virtual.${k}`, a: VIRTUAL_A, b: v.b, catalogIds: [`virtual.${k}`], grade: v.grade }));
  const byError: SubReport['byError'] = {};
  for (const model of ERRORS) {
    const tp = truePool(pool, model, SEED * 31 + subIndex);
    byError[model] = { strict: runStrict(tp, model, subIndex), competitor: runCompetitor(tp, model, subIndex) };
  }
  reports.push({
    subcategoryId: sub.id,
    title: sub.title,
    families: Object.fromEntries(GRADES.map((g) => [g, pool.filter((t) => t.grade === g).length])) as Record<Grade, number>,
    byError,
  });
}

/** Сводка по подкатегориям: среднее, минимум и максимум метрики. */
function summarize(pick: (r: SubReport) => number | null) {
  const xs = reports.map(pick).filter((x): x is number => x !== null && Number.isFinite(x));
  return { mean: r3(mean(xs)), min: r3(Math.min(...xs)), max: r3(Math.max(...xs)) };
}

type Path = (m: StrictMetrics & CompetitorMetrics) => number | null;
const ROWS: { key: string; label: string; setting: 'strict' | 'competitor'; target: string; get: Path }[] = [
  { key: 'strict.accuracy', setting: 'strict', label: 'Точность решения против метки популяции', target: '≥ 0,85', get: (m) => m.accuracy },
  { key: 'strict.falsePass', setting: 'strict', label: 'Ложное подтверждение (популяция ниже заявленного)', target: '≤ 0,10', get: (m) => m.falsePass },
  { key: 'strict.falseFail', setting: 'strict', label: 'Ложный отказ (популяция соответствует)', target: '≤ 0,20', get: (m) => m.falseFail },
  { key: 'strict.retest.decisionAgreement', setting: 'strict', label: 'Ретест: совпадение решения', target: '≥ 0,90', get: (m) => m.retest.decisionAgreement },
  { key: 'strict.retest.kappaBinary', setting: 'strict', label: 'Ретест: κ Коэна по бинарному решению', target: '≥ 0,70', get: (m) => m.retest.kappaBinary },
  { key: 'strict.auc.middleVsJunior', setting: 'strict', label: 'AUC θ̂ Middle против Junior (популяции пересекаются)', target: '≥ 0,90', get: (m) => m.auc.middleVsJunior },
  { key: 'strict.juniorClaimsMiddle.falseMiddle', setting: 'strict', label: 'Junior заявил Middle: ложный Middle', target: '≤ 0,10', get: (m) => m.juniorClaimsMiddle.falseMiddle },
  { key: 'strict.leak.falsePass', setting: 'strict', label: 'Утечка трюка 30 % шаблонов: ложное подтверждение', target: 'показать', get: (m) => m.leak.falsePass },
  { key: 'strict.retakeFalsePass', setting: 'strict', label: 'Пересдача после разбора (β = LEARN): ложное подтверждение 2-й попытки', target: 'показать', get: (m) => m.retakeFalsePass },
  { key: 'strict.retakeOverlap', setting: 'strict', label: 'Пересдача: доля семейств, повторённых из 1-й попытки', target: 'показать', get: (m) => m.retakeOverlap },
  { key: 'strict.bestOf3FalsePass', setting: 'strict', label: 'Лучшая из 3 попыток с обучением: ложное подтверждение', target: 'показать', get: (m) => m.bestOf3FalsePass },
  { key: 'strict.length.mean', setting: 'strict', label: 'Средняя длина, заданий', target: 'показать', get: (m) => m.length.mean },
  { key: 'strict.earlyStopShare', setting: 'strict', label: 'Доля ранних остановок основной фазы', target: 'показать', get: (m) => m.earlyStopShare },
  { key: 'strict.minutes.mean', setting: 'strict', label: 'Сумма лимитов времени, мин (верхняя граница)', target: 'показать', get: (m) => m.minutes.mean },
  { key: 'competitor.accuracy', setting: 'competitor', label: 'Точность решения против «θ выше порога»', target: '≥ 0,85', get: (m) => m.accuracy },
  { key: 'competitor.falsePass', setting: 'competitor', label: 'Ложное подтверждение (θ ниже порога)', target: '≤ 0,10', get: (m) => m.falsePass },
  { key: 'competitor.falseFail', setting: 'competitor', label: 'Ложный отказ (θ выше порога)', target: 'показать', get: (m) => m.falseFail },
  { key: 'competitor.byDistance.0', setting: 'competitor', label: 'Точность при |θ − порог| < 0,1', target: 'показать', get: (m) => m.byDistance[0]!.accuracy },
  { key: 'competitor.byDistance.3', setting: 'competitor', label: 'Точность при |θ − порог| ≥ 0,5', target: '≥ 0,95', get: (m) => m.byDistance[3]!.accuracy },
  { key: 'competitor.retest.decisionAgreement', setting: 'competitor', label: 'Ретест: совпадение решения', target: '≥ 0,90', get: (m) => m.retest.decisionAgreement },
  { key: 'competitor.retest.kappaBinary', setting: 'competitor', label: 'Ретест: κ по бинарному решению', target: '≥ 0,70', get: (m) => m.retest.kappaBinary },
  { key: 'competitor.retest.rTheta', setting: 'competitor', label: 'Ретест: r(θ̂₁, θ̂₂)', target: '≥ 0,80', get: (m) => m.retest.rTheta },
  { key: 'competitor.rThetaTrue', setting: 'competitor', label: 'r(θ̂, θ_true)', target: '≥ 0,80', get: (m) => m.rThetaTrue },
  { key: 'competitor.grade4.exact', setting: 'competitor', label: 'Грейд (4 класса): точно', target: 'показать', get: (m) => m.grade4.exact },
  { key: 'competitor.grade4.kappaWeighted', setting: 'competitor', label: 'Грейд: κw квадратичный против истины', target: 'показать', get: (m) => m.grade4.kappaWeighted },
  { key: 'competitor.grade4.retestAgreement', setting: 'competitor', label: 'Ретест грейда: совпадение', target: 'показать', get: (m) => m.grade4.retestAgreement },
  { key: 'competitor.grade4.retestKappa', setting: 'competitor', label: 'Ретест грейда: κ невзвешенный', target: 'показать', get: (m) => m.grade4.retestKappa },
  { key: 'competitor.grade4.retestKappaWeighted', setting: 'competitor', label: 'Ретест грейда: κw квадратичный', target: '≥ 0,70', get: (m) => m.grade4.retestKappaWeighted },
  { key: 'competitor.aucByBand.middleVsJunior', setting: 'competitor', label: 'AUC по полосам θ: Middle против Junior', target: '≥ 0,90', get: (m) => m.aucByBand.middleVsJunior },
  { key: 'competitor.aucByBand.seniorVsMiddle', setting: 'competitor', label: 'AUC по полосам θ: Senior против Middle', target: '≥ 0,90', get: (m) => m.aucByBand.seniorVsMiddle },
  { key: 'competitor.length.mean', setting: 'competitor', label: 'Средняя длина, заданий', target: 'показать', get: (m) => m.length.mean },
  { key: 'competitor.length.p90', setting: 'competitor', label: 'Длина, 90-й перцентиль', target: 'показать', get: (m) => m.length.p90 },
  { key: 'competitor.retest.familyOverlap', setting: 'competitor', label: 'Ретест: доля семейств 1-й попытки во 2-й', target: 'показать', get: (m) => m.retest.familyOverlap },
  { key: 'competitor.earlyStopShare', setting: 'competitor', label: 'Доля ранних остановок основной фазы', target: 'показать', get: (m) => m.earlyStopShare },
  { key: 'competitor.minutes.mean', setting: 'competitor', label: 'Сумма лимитов времени, мин (верхняя граница)', target: 'показать', get: (m) => m.minutes.mean },
];

const f = (x: number | null) => (x === null ? '–' : x.toFixed(3));
const rulesLabel = `${RULES_NAME}: ${RULES.min}–${RULES.max} заданий, SE-стоп ${RULES.seStop === null ? 'выключен' : (RULES.seStop ?? 0.4)}, P_confirm ${CONFIRM}${PROBE ? ', с дозадаванием' : ', без дозадавания'}`;
console.log(`# Валидация теста на грейд (синтетика): ${reports.length} подкатегорий, N = ${N} на подкатегорию и постановку, seed ${SEED}`);
console.log(`Правила ${rulesLabel}; пороги J ${GRADE_CUT.junior} / M ${GRADE_CUT.middle} / S ${GRADE_CUT.senior}; строгая популяция ${POPULATION}.\n`);
const summary: Record<string, Record<string, ReturnType<typeof summarize>>> = {};
for (const model of ERRORS) {
  summary[model] = {};
  const label = model === 'instance' ? `шум экземпляра σ = ${NOISE} на каждый показ` : `ошибка параметров на семейство: b + N(0; ${FAMILY_B}), ln a + N(0; ${FAMILY_A})`;
  console.log(`## Ошибка параметров: ${label}\n`);
  console.log('| Постановка | Метрика | Цель | Среднее по подкатегориям | Мин | Макс |\n|---|---|---|---|---|---|');
  for (const row of ROWS) {
    const s = summarize((r) => row.get(r.byError[model]![row.setting] as StrictMetrics & CompetitorMetrics));
    summary[model]![row.key] = s;
    console.log(`| ${row.setting === 'strict' ? 'строгая (наша)' : 'нормальная популяция'} | ${row.label} | ${row.target} | ${f(s.mean)} | ${f(s.min)} | ${f(s.max)} |`);
  }
  console.log('');
}
console.log(`## По подкатегориям (${ERRORS[0]}): строгая – точность / ложное подтв. / ретест; нормальная популяция – точность / ретест / κw грейда в ретесте / длина\n`);
console.log('| Подкатегория | J/M/S | Строгая: точн. | ложн. подтв. | ретест | Конк.: точн. | ретест | κw ретеста | длина |\n|---|---|---|---|---|---|---|---|---|');
for (const r of reports) {
  const s = r.byError[ERRORS[0]!]!.strict;
  const c = r.byError[ERRORS[0]!]!.competitor;
  console.log(`| ${r.subcategoryId} | ${GRADES.map((g) => r.families[g]).join('/')} | ${f(s.accuracy)} | ${f(s.falsePass)} | ${f(s.retest.decisionAgreement)} | ${f(c.accuracy)} | ${f(c.retest.decisionAgreement)} | ${f(c.grade4.retestKappaWeighted)} | ${f(c.length.mean)} |`);
}
console.log(`\nВремя прогона: ${((Date.now() - t0) / 1000).toFixed(1)} с`);

if (JSON_OUT) {
  const out = {
    schema: 'grade-test-validation/v1',
    generatedAt: new Date().toISOString(),
    command: `npx tsx eval/test/run.ts ${args.join(' ')}`.trim(),
    policy: { version: RULES_NAME, rules: { ...RULES, seStop: RULES.seStop === undefined ? 0.4 : RULES.seStop }, confirmProb: CONFIRM, probe: PROBE, cuts: { junior: GRADE_CUT.junior, middle: GRADE_CUT.middle, senior: GRADE_CUT.senior } },
    config: { n: N, seed: SEED, population: POPULATION, errorModels: ERRORS, instanceNoise: NOISE, familyError: { b: FAMILY_B, lnA: FAMILY_A } },
    settings: {
      strict: 'Наша строгая постановка: истина – метка популяции (популяции пересекаются и заходят за пороги), бинарное решение «подтверждён / нет», κ Коэна по бинарному решению.',
      competitor:
        'Нормальная популяция: θ ~ N(0; 1), истина – θ_true выше порога заявленного грейда; заявка – истинный грейд ±1; грейд 4 класса по старшему порогу с P ≥ 0,5; κw квадратичный; AUC по полосам истинной θ.',
    },
    rows: ROWS.map(({ key, label, setting, target }) => ({ key, label, setting, target })),
    summary,
    subcategories: reports,
  };
  // Блоки других скриптов (length-sweep.ts, bank-width.ts) в том же файле не затираются.
  if (existsSync(JSON_OUT)) {
    const prev = JSON.parse(readFileSync(JSON_OUT, 'utf8')) as Record<string, unknown>;
    for (const k of ['lengthSweep', 'bankWidth']) if (prev[k] !== undefined) (out as Record<string, unknown>)[k] = prev[k];
  }
  writeFileSync(JSON_OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`JSON: ${JSON_OUT}`);
}
