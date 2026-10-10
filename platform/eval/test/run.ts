// Валидация теста на грейд на синтетических кандидатах (ADR-0002 § валидация), без LLM и без БД.
// Тот же движок, что в проде: policy.selectNext по пулу фазы / nextStep (основная фаза + дозадавание
// Junior) / decide, параметры шаблонов из кода (экспертные). Запуск из platform/:
//   npx tsx eval/test/run.ts [--n 400] [--seed 1] [--noise 0.2] [--junior-cut −0.7] [--population persona|legacy] [--no-probe]
// --no-probe — только основная фаза (shouldStop), как до дозадавания Junior: для сравнения «до/после».
//
// Честная граница: симуляция проверяет свойства механики ПРИ ЗАДАННЫХ параметрах заданий
// (a, b экспертные, на людях не оценены), а не то, что задания измеряют умение.
import { generatorsFor } from '../../src/server/test/generators';
import { estimateTheta, probCorrect, type Response } from '../../src/server/test/irt';
import {
  CONFIRM_PROB,
  decide,
  GRADE_CUT,
  JUNIOR_PROBE_MAX,
  MAX_ITEMS,
  MIN_ITEMS,
  nextStep,
  phasePool,
  selectNext,
  shouldStop,
  type AttemptPhase,
  type SelectableTemplate,
} from '../../src/server/test/policy';
import { createRng, deriveSeed } from '../../src/server/test/rng';
import type { Grade, Specialization } from '../../src/server/types';

const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const N = arg('n', 400);
const SEED = arg('seed', 1);
const NOISE = arg('noise', 0.2);
const CONFIRM = arg('confirm', CONFIRM_PROB);
const MAXI = arg('max', MAX_ITEMS);
const MINI = arg('min', MIN_ITEMS);
const PROBE = !args.includes('--no-probe');
// Популяция синтетики: persona (по умолчанию) или legacy (старая, для сравнения «до/после»).
const popIdx = args.indexOf('--population');
const POPULATION = popIdx >= 0 ? args[popIdx + 1] : 'persona';
if (POPULATION !== 'persona' && POPULATION !== 'legacy') throw new Error(`--population: persona | legacy, получено ${POPULATION}`);
// Порог Junior для сравнения «до/после»: подменяет общий GRADE_CUT движка на весь прогон.
GRADE_CUT.junior = arg('junior-cut', GRADE_CUT.junior);

/** Нормальное распределение (Бокс–Мюллер) на детерминированном rng. */
function gauss(rng: ReturnType<typeof createRng>): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Популяции [В]: θ_true ~ N(μ, σ) по группе. Сдают заявленный грейд: Junior-тест — Junior (истина «да») и
// новичок («нет»); Middle-тест — Middle («да») и Junior («нет»).
// legacy: μ/σ выбраны из головы до персон (новичок −2,1 / Junior −0,8 / Middle 0,6; σ 0,5).
// persona (10.10.2026): среднее и разброс θ̂ симулированных персон (eval/test/personas.ts, N = 2000 попыток
// Junior-теста на персону, боевой движок, пороги −0,7 / −0,1): ниже Junior (B1, B2, F3) θ̂ = −0,94 ± 0,51;
// Junior (B3, B4, F1) 0,30 ± 0,32; Middle (B5, F2) 0,77 ± 0,58 (контроль Z0 исключён). Округлено до 0,1;
// σ Junior поднята с 0,32 до 0,4 (по заданию не меньше 0,4: 0,32 — разброс оценщика у трёх персон, не людей).
// Это θ̂ после оценки, а не истинное θ: шум оценки при прогоне добавится ещё раз (популяция чуть «размыта»).
// Параметры подобраны по симуляции персон агентом; живой разметки нет.
const POPS: Record<string, Record<string, { mu: number; sd: number }>> = {
  legacy: { novice: { mu: -2.1, sd: 0.5 }, junior: { mu: -0.8, sd: 0.5 }, middle: { mu: 0.6, sd: 0.5 } },
  persona: { novice: { mu: -0.9, sd: 0.5 }, junior: { mu: 0.3, sd: 0.4 }, middle: { mu: 0.8, sd: 0.6 } },
};
const POP = POPS[POPULATION]!;

interface Sim {
  thetaTrue: number;
  trueGrade: Grade;
  claimed: Grade;
}

interface Outcome {
  theta: number;
  pPass: number;
  confirmed: boolean;
  juniorOffered: boolean;
  length: number;
  shown: string[];
  correct: number;
  /** Была ли фаза дозадавания Junior. */
  probed: boolean;
}

/** Один прогон адаптивного теста для кандидата: тот же цикл, что в service.ts, без БД. */
function runAttempt(pool: SelectableTemplate[], sim: Sim, attemptSeed: number, rng: ReturnType<typeof createRng>, trick: Set<string>, cfg = { confirm: CONFIRM, min: MINI, max: MAXI }): Outcome {
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  let est = estimateTheta([]);
  let correct = 0;
  let phase: AttemptPhase = 'main';
  let probed = false;
  for (let index = 0; index < 100; index++) {
    const next = selectNext(phasePool(pool, phase), { shown, theta: est.theta, seed: deriveSeed(attemptSeed, 1000 + index) });
    if (!next) break;
    shown.push(next);
    // Экземпляр «не совсем изоморфен»: b_экз = b + ε; знание трюка шаблона: +0,3 к P.
    const bInst = next.b + NOISE * gauss(rng);
    let p = probCorrect(sim.thetaTrue, { a: next.a, b: bInst });
    if (trick.has(next.id)) p = Math.min(1, p + 0.3);
    const ok = rng.next() < p;
    if (ok) correct++;
    responses.push({ a: next.a, b: next.b, correct: ok });
    est = estimateTheta(responses);
    if (!PROBE) {
      if (shouldStop(responses.length, est, sim.claimed, shown.length >= pool.length, { min: cfg.min, max: cfg.max }).stop) break;
      continue;
    }
    const step = nextStep({ pool, shown, responses, grade: sim.claimed }, { min: cfg.min, max: cfg.max });
    if (step.phase === 'junior_probe') probed = true;
    if (step.stop) break;
    phase = step.phase;
  }
  const d = decide(responses, sim.claimed, cfg.confirm);
  return { theta: d.theta, pPass: d.pPass, confirmed: d.confirmed, juniorOffered: d.juniorOffered, length: responses.length, shown: shown.map((s) => s.id), correct, probed };
}

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

function kappa(a: boolean[], b: boolean[]): number {
  const n = a.length;
  let agree = 0;
  let a1 = 0;
  let b1 = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    if (a[i]) a1++;
    if (b[i]) b1++;
  }
  const po = agree / n;
  const pe = (a1 / n) * (b1 / n) + (1 - a1 / n) * (1 - b1 / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

const fmt = (x: number, d = 3) => (Number.isNaN(x) ? '—' : x.toFixed(d));
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

interface SpecReport {
  spec: Specialization;
  rows: [string, string, string][];
  exposure: { id: string; grade: Grade; b: number; share: number; rpb: number }[];
}

function runSpec(spec: Specialization): SpecReport {
  const rng = createRng(SEED * 7919 + (spec === 'backend' ? 1 : 2));
  const pool: SelectableTemplate[] = generatorsFor(spec).map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
  const sims: (Sim & { pop: string })[] = [];
  for (let i = 0; i < N; i++) {
    const pop = (['novice', 'junior', 'junior', 'middle'] as const)[i % 4]!;
    const claimed: Grade = i % 4 === 0 || i % 4 === 1 ? 'junior' : 'middle';
    const thetaTrue = POP[pop]!.mu + POP[pop]!.sd * gauss(rng);
    sims.push({ thetaTrue, trueGrade: pop === 'middle' ? 'middle' : 'junior', claimed, pop });
  }
  // Основной сценарий: две попытки с разными seed.
  const first = sims.map((s, i) => runAttempt(pool, s, deriveSeed(SEED, i), rng, new Set()));
  const second = sims.map((s, i) => runAttempt(pool, s, deriveSeed(SEED + 100_000, i), rng, new Set()));

  // Истина — метка популяции: Junior-тест сдаёт Junior, Middle-тест — Middle.
  const truth = sims.map((s) => (s.claimed === 'junior' ? s.pop !== 'novice' : s.pop === 'middle'));
  const acc = first.filter((o, i) => o.confirmed === truth[i]).length / N;
  const nearIdx = sims.map((s, i) => i).filter((i) => Math.abs(sims[i]!.thetaTrue - GRADE_CUT[sims[i]!.claimed]) <= 0.3);
  const accNear = nearIdx.filter((i) => first[i]!.confirmed === truth[i]).length / Math.max(1, nearIdx.length);
  const farIdx = sims.map((s, i) => i).filter((i) => Math.abs(sims[i]!.thetaTrue - GRADE_CUT[sims[i]!.claimed]) > 0.3);
  const accFar = farIdx.filter((i) => first[i]!.confirmed === truth[i]).length / Math.max(1, farIdx.length);
  // Ложные подтверждения: популяция ниже заявленного грейда, но подтверждён; ложные отказы — наоборот.
  const belowIdx = sims.map((s, i) => i).filter((i) => !truth[i]);
  const falsePass = belowIdx.filter((i) => first[i]!.confirmed).length / Math.max(1, belowIdx.length);
  const aboveIdx = sims.map((s, i) => i).filter((i) => truth[i]);
  const falseFail = aboveIdx.filter((i) => !first[i]!.confirmed).length / Math.max(1, aboveIdx.length);
  const accJuniorTest = sims.map((s, i) => i).filter((i) => sims[i]!.claimed === 'junior').filter((i) => first[i]!.confirmed === truth[i]).length / sims.filter((s) => s.claimed === 'junior').length;
  const accMiddleTest = sims.map((s, i) => i).filter((i) => sims[i]!.claimed === 'middle').filter((i) => first[i]!.confirmed === truth[i]).length / sims.filter((s) => s.claimed === 'middle').length;

  // Разделение J/M по θ̂ (истинный класс по смеси).
  const aucJM = auc(
    first.filter((_, i) => sims[i]!.pop === 'middle').map((o) => o.theta),
    first.filter((_, i) => sims[i]!.pop === 'junior').map((o) => o.theta),
  );
  const aucJN = auc(
    first.filter((_, i) => sims[i]!.pop === 'junior').map((o) => o.theta),
    first.filter((_, i) => sims[i]!.pop === 'novice').map((o) => o.theta),
  );
  // Test-retest.
  const retest = first.filter((o, i) => o.confirmed === second[i]!.confirmed).length / N;
  const k = kappa(first.map((o) => o.confirmed), second.map((o) => o.confirmed));
  const r = pearson(first.map((o) => o.theta), second.map((o) => o.theta));
  const overlap = first.reduce((s, o, i) => s + o.shown.filter((id) => second[i]!.shown.includes(id)).length / o.shown.length, 0) / N;
  const meanLen = first.reduce((s, o) => s + o.length, 0) / N;
  const juniorIdx = sims.map((_, i) => i).filter((i) => sims[i]!.claimed === 'junior');
  const middleIdx = sims.map((_, i) => i).filter((i) => sims[i]!.claimed === 'middle');
  const probedShare = (idx: number[]) => idx.filter((i) => first[i]!.probed).length / Math.max(1, idx.length);
  const lenOf = (idx: number[]) => idx.reduce((s, i) => s + first[i]!.length, 0) / Math.max(1, idx.length);
  const corr = pearson(first.map((o) => o.theta), sims.map((s) => s.thetaTrue));

  // Junior заявляет Middle: как часто подтверждается Middle (ложно) и предлагается Junior.
  const juniorsClaimMiddle = sims.filter((s) => s.pop === 'junior').map((s) => ({ ...s, claimed: 'middle' as Grade }));
  const jcm = juniorsClaimMiddle.map((s, i) => runAttempt(pool, s, deriveSeed(SEED + 200_000, i), rng, new Set()));
  const jcmFalseMiddle = jcm.filter((o) => o.confirmed).length / jcm.length;
  const jcmOffered = jcm.filter((o) => o.juniorOffered).length / jcm.length;
  const jcmTrueJuniors = juniorsClaimMiddle.map((s, i) => [s.thetaTrue > GRADE_CUT.junior, jcm[i]!.juniorOffered] as const);
  const jcmOfferAcc = jcmTrueJuniors.filter(([t, o]) => t === o).length / jcmTrueJuniors.length;

  // Утечка: 30 % шаблонов «известен трюк» (+0,3 к P) — насколько растёт доля подтверждений у тех, кто ниже порога.
  const trick = new Set(createRng(SEED + 5).sample(pool.map((p) => p.id), Math.round(pool.length * 0.3)));
  const leaked = sims.map((s, i) => runAttempt(pool, s, deriveSeed(SEED + 300_000, i), rng, trick));
  const leakFalsePass = belowIdx.filter((i) => leaked[i]!.confirmed).length / Math.max(1, belowIdx.length);

  // Пересдачи: лучший из 3 попыток у тех, кто ниже порога (без интервала — верхняя граница завышения).
  const third = sims.map((s, i) => runAttempt(pool, s, deriveSeed(SEED + 400_000, i), rng, new Set()));
  const bestOf3 = belowIdx.filter((i) => first[i]!.confirmed || second[i]!.confirmed || third[i]!.confirmed).length / Math.max(1, belowIdx.length);

  // Экспозиция и точечно-бисериальная по шаблонам.
  const exposure = pool
    .map((t) => {
      const seen = first.filter((o) => o.shown.includes(t.id)).length / N;
      // r_pb: корреляция «решил шаблон» с θ̂ среди тех, кому показан. Нужны ответы — повторяем по θ_true модельно.
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < N; i++) {
        if (!first[i]!.shown.includes(t.id)) continue;
        xs.push(rng.next() < probCorrect(sims[i]!.thetaTrue, t) ? 1 : 0);
        ys.push(first[i]!.theta);
      }
      return { id: t.id, grade: t.grade, b: t.b, share: seen, rpb: xs.length > 10 ? pearson(xs, ys) : NaN };
    })
    .sort((x, y) => y.share - x.share);

  const rows: [string, string, string][] = [
    ['Точность решения (подтверждён ⇔ популяция не ниже заявленного грейда), все', '≥ 85 %', pct(acc)],
    ['— Junior-тест (Junior против новичка)', '≥ 85 %', pct(accJuniorTest)],
    ['— Middle-тест (Middle против Junior)', '≥ 85 %', pct(accMiddleTest)],
    ['— вне зоны ±0,3 от порога', 'показать', `${pct(accFar)} (n = ${farIdx.length})`],
    ['— в зоне ±0,3 от порога', 'показать как есть', `${pct(accNear)} (n = ${nearIdx.length})`],
    ['Ложное подтверждение (популяция ниже заявленного, но подтверждён)', '≤ 10 %', pct(falsePass)],
    ['Ложный отказ (популяция соответствует, но не подтверждён)', '≤ 20 %', pct(falseFail)],
    ['AUC θ̂: Middle против Junior', '≥ 0,90', fmt(aucJM)],
    ['AUC θ̂: Junior против новичка', '≥ 0,90', fmt(aucJN)],
    ['r(θ̂, θ_true)', '≥ 0,80', fmt(corr)],
    ['Test-retest: совпадение исхода двух попыток', '≥ 90 %', pct(retest)],
    ['Test-retest: κ Коэна', '≥ 0,70', fmt(k)],
    ['Test-retest: r(θ̂₁, θ̂₂)', '≥ 0,80', fmt(r)],
    ['Средняя длина теста, заданий', `7–10${PROBE ? ` (+ до ${JUNIOR_PROBE_MAX} дозаданных)` : ''}`, `${fmt(meanLen, 2)} (Junior-тест ${fmt(lenOf(juniorIdx), 2)}, Middle-тест ${fmt(lenOf(middleIdx), 2)})`],
    ['Доля попыток с дозадаванием Junior', 'показать', PROBE ? `Junior-тест ${pct(probedShare(juniorIdx))}, Middle-тест ${pct(probedShare(middleIdx))}` : 'выключено (--no-probe)'],
    ['Пересечение шаблонов двух попыток одного кандидата', 'показать', pct(overlap)],
    ['Junior заявил Middle: ложно подтверждён Middle', '≤ 10 %', pct(jcmFalseMiddle)],
    ['Junior заявил Middle: предложен Junior по той же попытке', 'показать', pct(jcmOffered)],
    ['— предложение Junior совпадает с θ_true > порог Junior', '≥ 85 %', pct(jcmOfferAcc)],
    ['Утечка трюка 30 % шаблонов: ложное подтверждение', '≤ 10 % + базовое', `${pct(leakFalsePass)} (без утечки ${pct(falsePass)})`],
    ['Лучший из 3 попыток без интервала: ложное подтверждение', 'показать', `${pct(bestOf3)} (одна попытка ${pct(falsePass)})`],
    ['Максимальная доля попыток с одним шаблоном', '≤ 0,9 (банк 12, тест ≤ 10)', fmt(Math.max(...exposure.map((e) => e.share)), 2)],
  ];
  return { spec, rows, exposure };
}

const t0 = Date.now();
const reports = (['backend', 'frontend'] as Specialization[]).map(runSpec);
console.log(`# Валидация теста на грейд (синтетика): N = ${N} на специализацию, seed = ${SEED}, шум экземпляра σ = ${NOISE}, популяция ${POPULATION}, пороги Junior ${GRADE_CUT.junior} / Middle ${GRADE_CUT.middle}, ${PROBE ? 'с дозадаванием Junior' : 'без дозадавания'}\n`);
for (const rep of reports) {
  console.log(`## ${rep.spec}\n`);
  console.log('| Метрика | Цель | Факт |\n|---|---|---|');
  for (const [m, g, v] of rep.rows) console.log(`| ${m} | ${g} | ${v} |`);
  console.log('\n| Шаблон | Грейд | b | Доля попыток | r_pb |\n|---|---|---|---|---|');
  for (const e of rep.exposure) console.log(`| ${e.id} | ${e.grade} | ${e.b} | ${fmt(e.share, 2)} | ${fmt(e.rpb, 2)} |`);
  console.log('');
}
// Чувствительность к порогу подтверждения и длине теста (вопрос владельцу): та же синтетика, backend.
console.log('## Чувствительность (backend): порог подтверждения × максимум заданий\n');
console.log('| P_confirm | min–max | Точность | Ложное подтв. | Ложный отказ | Retest | Длина |\n|---|---|---|---|---|---|---|');
{
  // Одни и те же кандидаты и один seed ответов во всех ячейках — сравнение честное.
  const gridRng = createRng(SEED * 31 + 7);
  const gridSims = Array.from({ length: N }, (_, i) => {
    const pop = (['novice', 'junior', 'junior', 'middle'] as const)[i % 4]!;
    const claimed: Grade = i % 4 <= 1 ? 'junior' : 'middle';
    const sim: Sim = { thetaTrue: POP[pop]!.mu + POP[pop]!.sd * gauss(gridRng), trueGrade: pop === 'middle' ? 'middle' : 'junior', claimed };
    return { sim, truth: claimed === 'junior' ? pop !== 'novice' : pop === 'middle' };
  });
  const pool: SelectableTemplate[] = generatorsFor('backend').map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
  for (const confirm of [0.8, 0.7, 0.6]) {
    for (const [min, max] of [[7, 10], [8, 12]] as const) {
      let ok = 0;
      let fp = 0;
      let fpN = 0;
      let fn = 0;
      let fnN = 0;
      let same = 0;
      let len = 0;
      const cfg = { confirm, min, max };
      gridSims.forEach(({ sim, truth }, i) => {
        const o1 = runAttempt(pool, sim, deriveSeed(SEED, i), createRng(deriveSeed(SEED + 11, i)), new Set(), cfg);
        const o2 = runAttempt(pool, sim, deriveSeed(SEED + 100_000, i), createRng(deriveSeed(SEED + 12, i)), new Set(), cfg);
        if (o1.confirmed === truth) ok++;
        if (!truth) {
          fpN++;
          if (o1.confirmed) fp++;
        } else {
          fnN++;
          if (!o1.confirmed) fn++;
        }
        if (o1.confirmed === o2.confirmed) same++;
        len += o1.length;
      });
      console.log(`| ${confirm} | ${min}–${max} | ${pct(ok / N)} | ${pct(fp / fpN)} | ${pct(fn / fnN)} | ${pct(same / N)} | ${(len / N).toFixed(2)} |`);
    }
  }
}
console.log(`\nВремя прогона: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
