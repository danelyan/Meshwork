// Валидация индекса честности и подтверждающего теста на синтетических персонах (ADR-0002, дополнение 11.10),
// без LLM и без БД. Те же функции, что в проде: policy (selectNext / nextStep / decide), irt, integrity (assessAttempt,
// canarySlots, wantsCanary, canaryHit), confirm (пул, остановка, decideConfirm). Меняются только «люди»: ответы,
// время и браузерные сигналы порождают модели ниже.
//
// Запуск из platform/:
//   npm run eval:test-integrity                                  # 4 подкатегории, N = 300, ловушка p = 0,3 / 0,6 / 0,9
//   npx tsx eval/test/integrity.ts --n 1000 --json eval/test/integrity-results.json
//   npx tsx eval/test/integrity.ts --sub backend.web-api --n 200 # одна подкатегория
//   npx tsx eval/test/integrity.ts --sigma 0.4 --noise-tabs 0.4  # чувствительность к модели честного кандидата
//
// Честная граница: персоны — модели, не люди. Распределения времени, браузерного шума честных и поведение
// читеров — наши допущения; пороги integrity.ts экспертные. Цифры показывают свойства правил ПРИ этих допущениях,
// а не долю пойманных читеров в реальности.
import { writeFileSync } from 'node:fs';

import { SUBCATEGORIES } from '../../src/lib/directions';
import type { Grade } from '../../src/lib/grades';
import { cleanResponses, CONFIRM_CANARIES, CONFIRM_MIN_ITEMS, confirmRemaining, confirmSelectionPool, confirmShouldStop, confirmTimeLimit, decideConfirm, GRADE_CANARIES } from '../../src/server/test/confirm';
import { poolFor } from '../../src/server/test/generators';
import {
  assessAttempt,
  CANARY_SHIFT_MAX,
  CANARY_SHIFT_MIN,
  canarySlots,
  wantsCanary,
  type BrowserSignals,
  type IntegrityLevel,
  type IntegrityReason,
  type ItemObservation,
} from '../../src/server/test/integrity';
import { estimateTheta, probCorrect, type Response } from '../../src/server/test/irt';
import { decide, MIN_ITEMS, nextStep, phasePool, selectNext, START_THETA, type AttemptPhase, type SelectableTemplate } from '../../src/server/test/policy';
import { createRng, deriveSeed, type Rng } from '../../src/server/test/rng';
import type { AnswerFormat } from '../../src/server/test/types';

const args = process.argv.slice(2);
const argStr = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const argNum = (name: string, def: number) => (argStr(name) !== undefined ? Number(argStr(name)) : def);
const N = argNum('n', 300);
const SEED = argNum('seed', 1);
/** Ошибка b задания в генераторе ответов (как --noise в run.ts). */
const NOISE = argNum('noise', 0.2);
/** σ ln(времени) честного кандидата внутри человека (допущение). */
const SIGMA = argNum('sigma', 0.5);
/** Среднее число уходов со вкладки у честного за попытку (Пуассон; допущение). */
const NOISE_TABS = argNum('noise-tabs', 0.8);
/** Доля честных попыток со вставкой / копированием (допущение: нужны, например, для сверки с консолью). */
const NOISE_PASTE = argNum('noise-paste', 0.03);
const NOISE_COPY = argNum('noise-copy', 0.04);
const CLAIM_CHEAT: Grade = (argStr('claim') as Grade | undefined) ?? 'middle';
const JSON_OUT = argStr('json');
const SUB_ARG = argStr('sub');
const CANARY_PS = [0.3, 0.6, 0.9];

// --- примитивы ------------------------------------------------------------------------------------------

function gauss(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const uniform = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng.next();
function poisson(rng: Rng, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > l);
  return k - 1;
}
const binomial = (rng: Rng, n: number, p: number) => Array.from({ length: n }, () => rng.next() < p).filter(Boolean).length;

/** Популяции θ — те же, что `persona` в eval/test/run.ts (θ̂ персон под политикой v3; Senior — допущение). */
const POP: Record<'novice' | Grade, { mu: number; sd: number }> = {
  novice: { mu: -0.9, sd: 0.5 },
  junior: { mu: 0.3, sd: 0.4 },
  middle: { mu: 0.8, sd: 0.6 },
  senior: { mu: 1.6, sd: 0.5 },
};

interface PoolItem extends SelectableTemplate {
  format: AnswerFormat;
  limit: number;
}

// --- поведение персон ----------------------------------------------------------------------------------

interface ItemCtx {
  item: PoolItem;
  index: number;
  /** Истинная сложность экземпляра. */
  trueB: number;
  /** Задание с ловушкой. */
  canary: boolean;
  /** Лимит времени этой попытки (для подтверждающей — 0,7). */
  limit: number;
}

/** Модель поведения кандидата на одной попытке. */
interface Behavior {
  /** Верно ли решит (до учёта ловушки). */
  correct(ctx: ItemCtx, rng: Rng, thetaTrue: number): boolean;
  /** Время ответа, сек. */
  seconds(ctx: ItemCtx, rng: Rng, thetaTrue: number): number;
  /** Попадёт ли в ловушку на этом задании (только если стоит). */
  hitsCanary(rng: Rng): boolean;
  /** Агрегаты браузера за попытку из n заданий. */
  signals(n: number, rng: Rng): BrowserSignals;
}

/** Человек: ответы по 2PL при истинной θ, время логнормально, браузерный шум небольшой. */
function human(medianShare: number): Behavior {
  return {
    correct: (c, rng, th) => rng.next() < probCorrect(th, { a: c.item.a, b: c.trueB }),
    seconds: (c, rng, th) => Math.min(3 * c.limit, medianShare * c.limit * Math.exp(0.3 * (c.trueB - th)) * Math.exp(SIGMA * gauss(rng))),
    hitsCanary: () => false,
    signals: (_n, rng) => {
      const tabs = poisson(rng, NOISE_TABS);
      const paste = rng.next() < NOISE_PASTE;
      return {
        tabHidden: tabs,
        hiddenMs: Array.from({ length: tabs }, () => uniform(rng, 3, 30) * 1000).reduce((s, x) => s + x, 0),
        pastes: paste ? 1 : 0,
        pasteChars: paste ? rng.int(20, 200) : 0,
        copies: rng.next() < NOISE_COPY ? 1 : 0,
        extendedScreen: rng.next() < 0.15,
      };
    },
  };
}

interface CheatSpec {
  id: string;
  label: string;
  /** P(ответ верен), если не ловушка. */
  pCorrect: number;
  medianSec: number;
  sigma: number;
  canaryP: number;
  /** Доля заданий, чьё условие копируют / вставляют ответ. */
  copyRate: number;
  pasteRate: number;
}

function cheater(s: CheatSpec): Behavior {
  return {
    correct: (_c, rng) => rng.next() < s.pCorrect,
    seconds: (c, rng) => Math.min(3 * c.limit, s.medianSec * Math.exp(s.sigma * gauss(rng))),
    hitsCanary: (rng) => rng.next() < s.canaryP,
    signals: (n, rng) => {
      const copies = binomial(rng, n, s.copyRate);
      const pastes = binomial(rng, n, s.pasteRate);
      return {
        // Каждое копирование условия — уход на вкладку нейросети.
        tabHidden: copies,
        hiddenMs: Array.from({ length: copies }, () => uniform(rng, 15, 40) * 1000).reduce((a, x) => a + x, 0),
        pastes,
        pasteChars: pastes * rng.int(10, 120),
        copies,
        extendedScreen: rng.next() < 0.15,
      };
    },
  };
}

interface Persona {
  id: string;
  label: string;
  kind: 'honest' | 'cheat';
  claimed: Grade;
  /** Истинная θ человека (у читера — его собственный уровень, он нужен в подтверждающем тесте без помощи). */
  theta: (rng: Rng) => number;
  /** Поведение в основной попытке. */
  main: (rng: Rng) => Behavior;
  /** Поведение читера в подтверждающем тесте: unaided — сам, repeat — снова с помощью. */
  confirm: { unaided: (rng: Rng) => Behavior; repeat: (rng: Rng) => Behavior };
}

const honestPersona = (grade: Grade, label: string): Persona => ({
  id: `honest-${grade}`,
  label,
  kind: 'honest',
  claimed: grade,
  theta: (rng) => POP[grade].mu + POP[grade].sd * gauss(rng),
  main: (rng) => human(uniform(rng, 0.4, 0.6)),
  confirm: { unaided: () => human(0.5), repeat: () => human(0.5) },
});

function cheatPersona(spec: CheatSpec): Persona {
  const ownMedian = (rng: Rng) => human(uniform(rng, 0.4, 0.6));
  return {
    id: spec.id,
    label: spec.label,
    kind: 'cheat',
    claimed: CLAIM_CHEAT,
    theta: (rng) => POP.novice.mu + POP.novice.sd * gauss(rng),
    main: () => cheater(spec),
    confirm: { unaided: ownMedian, repeat: () => cheater(spec) },
  };
}

const PERSONAS: Persona[] = [
  honestPersona('junior', 'честный Junior'),
  honestPersona('middle', 'честный Middle'),
  honestPersona('senior', 'честный Senior'),
  {
    id: 'honest-slow',
    label: 'медленный честный (Middle, медиана 90 % лимита)',
    kind: 'honest',
    claimed: 'middle',
    theta: (rng) => POP.middle.mu + POP.middle.sd * gauss(rng),
    main: (rng) => human(uniform(rng, 0.8, 1.0)),
    confirm: { unaided: () => human(0.9), repeat: () => human(0.9) },
  },
  ...CANARY_PS.map((p) =>
    cheatPersona({ id: `cheat-copy-p${Math.round(p * 100)}`, label: `копирует условие в нейросеть, ловушка p = ${p}`, pCorrect: 0.95, medianSec: 32, sigma: 0.25, canaryP: p, copyRate: 0.9, pasteRate: 0.5 }),
  ),
  cheatPersona({ id: 'cheat-second-device', label: 'нейросеть на втором устройстве (без ловушки и браузерных сигналов)', pCorrect: 0.95, medianSec: 45, sigma: 0.25, canaryP: 0, copyRate: 0, pasteRate: 0 }),
  cheatPersona({ id: 'cheat-leaked-keys', label: 'слитые ключи (очень быстро)', pCorrect: 0.97, medianSec: 6, sigma: 0.4, canaryP: 0, copyRate: 0, pasteRate: 0 }),
];

// --- попытка -------------------------------------------------------------------------------------------

interface Stage {
  level: IntegrityLevel;
  reasons: IntegrityReason[];
  theta: number;
  length: number;
  responses: Response[];
  obs: ItemObservation[];
  flaggedItems: number[];
  canaryHit: boolean;
}

function makeAnswer(ctx: ItemCtx, canaryShift: number | null, correct: boolean, hit: boolean, rng: Rng): { answer: string; key: string } {
  const key = String(100 + ctx.index * 7);
  if (hit && canaryShift !== null) return { answer: String(Number(key) + canaryShift), key };
  if (correct) return { answer: key, key };
  // Неверный числовой ответ человека: чаще промах на 1–2, иначе произвольное число (допущение).
  const off = rng.next() < 0.6 ? rng.pick([-2, -1, 1, 2]) : rng.int(-30, 30) || 5;
  return { answer: String(Number(key) + off), key };
}

function observe(ctx: ItemCtx, canaryShift: number | null, correct: boolean, seconds: number, answer: { answer: string; key: string }): ItemObservation {
  return { a: ctx.item.a, b: ctx.item.b, index: ctx.index, correct, seconds, timeLimitSec: ctx.limit, format: ctx.item.format, answer: answer.answer, answerKey: answer.key, canaryShift };
}

/** Основная попытка: цикл service.ts (selectNext / nextStep) + ловушки + индекс. */
function runGrade(pool: PoolItem[], p: Persona, thetaTrue: number, beh: Behavior, attemptSeed: number, rng: Rng) {
  const slotRng = createRng(deriveSeed(attemptSeed, 5000));
  const slots = canarySlots(slotRng.int, GRADE_CANARIES, 1, MIN_ITEMS - 2);
  const shown: PoolItem[] = [];
  const responses: Response[] = [];
  const obs: ItemObservation[] = [];
  let phase: AttemptPhase = 'main';
  for (let index = 0; index < pool.length; index++) {
    const theta = responses.length ? estimateTheta(responses).theta : START_THETA[p.claimed];
    const next = selectNext(phasePool(pool, phase, p.claimed), { shown, theta, seed: deriveSeed(attemptSeed, 1000 + index) }) as PoolItem | null;
    if (!next) break;
    shown.push(next);
    const placed = obs.filter((o) => o.canaryShift !== null).length;
    const canary = wantsCanary(index, placed, slots, next.format);
    const canaryShift = canary ? createRng(deriveSeed(attemptSeed, 6000 + index)).int(CANARY_SHIFT_MIN, CANARY_SHIFT_MAX) : null;
    const ctx: ItemCtx = { item: next, index, trueB: next.b + NOISE * gauss(rng), canary, limit: next.limit };
    const hit = canary && beh.hitsCanary(rng);
    const correct = hit ? false : beh.correct(ctx, rng, thetaTrue);
    const seconds = beh.seconds(ctx, rng, thetaTrue);
    obs.push(observe(ctx, canaryShift, correct, seconds, makeAnswer(ctx, canaryShift, correct, hit, rng)));
    responses.push({ a: next.a, b: next.b, correct });
    const step = nextStep({ pool, shown, responses, grade: p.claimed });
    if (step.stop) break;
    phase = step.phase;
  }
  const d = decide(responses, p.claimed);
  const idx = assessAttempt(obs, d.theta, beh.signals(responses.length, rng));
  const grantable: Grade | null = d.confirmed ? p.claimed : d.juniorOffered ? d.offeredGrade : null;
  const stage: Stage = {
    level: idx.level,
    reasons: idx.reasons,
    theta: d.theta,
    length: responses.length,
    responses,
    obs,
    flaggedItems: idx.flaggedItems,
    canaryHit: idx.reasons.some((r) => r.group === 'canary'),
  };
  return { stage, grantable, shown };
}

/** Подтверждающая попытка: confirmSelectionPool / confirmShouldStop / decideConfirm, как в service.ts. */
function runConfirm(pool: PoolItem[], src: Stage, srcShown: PoolItem[], grade: Grade, thetaTrue: number, beh: Behavior, seed: number, rng: Rng): { confirmed: boolean; level: IntegrityLevel; length: number } {
  const clean = cleanResponses(src.responses.map((r, index) => ({ ...r, index })), src.flaggedItems);
  const srcIds = new Set(srcShown.map((t) => t.id));
  const slots = canarySlots(createRng(deriveSeed(seed, 5000)).int, CONFIRM_CANARIES, 0, CONFIRM_MIN_ITEMS - 2);
  const shown: PoolItem[] = [];
  const own: Response[] = [];
  const obs: ItemObservation[] = [];
  let theta = estimateTheta(clean).theta;
  for (let index = 0; index < pool.length; index++) {
    const shownIds = new Set(shown.map((t) => t.id));
    const from = confirmSelectionPool(pool, srcIds, shownIds);
    const next = selectNext(from, { shown, theta, seed: deriveSeed(seed, 1000 + index) }) as PoolItem | null;
    if (!next) break;
    shown.push(next);
    const placed = obs.filter((o) => o.canaryShift !== null).length;
    const canary = wantsCanary(index, placed, slots, next.format);
    const canaryShift = canary ? createRng(deriveSeed(seed, 6000 + index)).int(CANARY_SHIFT_MIN, CANARY_SHIFT_MAX) : null;
    const limit = confirmTimeLimit(next.limit);
    const ctx: ItemCtx = { item: next, index, trueB: next.b + NOISE * gauss(rng), canary, limit };
    const hit = canary && beh.hitsCanary(rng);
    const correct = hit ? false : beh.correct(ctx, rng, thetaTrue);
    obs.push(observe(ctx, canaryShift, correct, beh.seconds(ctx, rng, thetaTrue), makeAnswer(ctx, canaryShift, correct, hit, rng)));
    own.push({ a: next.a, b: next.b, correct });
    const combined = [...clean, ...own];
    theta = estimateTheta(combined).theta;
    if (confirmShouldStop(own.length, combined, grade, confirmRemaining(pool, new Set(shown.map((t) => t.id))))) break;
  }
  const est = estimateTheta([...clean, ...own]);
  const idx = assessAttempt(obs, est.theta, beh.signals(own.length, rng));
  const d = decideConfirm(clean, own, grade, idx.level);
  return { confirmed: d.confirmed, level: idx.level, length: own.length };
}

// --- прогон --------------------------------------------------------------------------------------------

interface Tally {
  n: number;
  low: number;
  medium: number;
  high: number;
  /** Подтверждена или предложена оценка ниже (есть что выдавать). */
  grantable: number;
  /** high при grantable — попытка уходит в needs_confirmation. */
  blocking: number;
  /** Есть что выдавать, а индекс не high: категория выдана без проверки. */
  grantedUnchecked: number;
  canaryHit: number;
  /** Подтверждающий: попыток и пройдено (без помощи / с помощью снова). */
  confirmUnaided: { n: number; passed: number };
  confirmRepeat: { n: number; passed: number };
  /** Для high: какие группы причин (сочетания). */
  highGroups: Record<string, number>;
  length: number;
  /** Причины: сколько попыток с кодом. */
  codes: Record<string, number>;
}
const emptyTally = (): Tally => ({ n: 0, low: 0, medium: 0, high: 0, grantable: 0, blocking: 0, grantedUnchecked: 0, canaryHit: 0, confirmUnaided: { n: 0, passed: 0 }, confirmRepeat: { n: 0, passed: 0 }, highGroups: {}, length: 0, codes: {} });

function add(t: Tally, o: { stage: Stage; grantable: Grade | null }) {
  const blocking = o.stage.level === 'high' && o.grantable !== null;
  t.n++;
  t[o.stage.level]++;
  if (o.grantable !== null) t.grantable++;
  if (blocking) t.blocking++;
  if (o.grantable !== null && o.stage.level !== 'high') t.grantedUnchecked++;
  if (o.stage.canaryHit) t.canaryHit++;
  if (o.stage.level === 'high') {
    const key = [...new Set(o.stage.reasons.map((r) => r.group))].sort().join('+');
    t.highGroups[key] = (t.highGroups[key] ?? 0) + 1;
  }
  t.length += o.stage.length;
  for (const code of new Set(o.stage.reasons.map((r) => r.code))) t.codes[code] = (t.codes[code] ?? 0) + 1;
}

const subs = SUBCATEGORIES.filter((s) => (SUB_ARG ? s.id === SUB_ARG : ['backend.web-api', 'frontend.ui-app', 'ai.llm-apps', 'engineering.devops'].includes(s.id)));
const byPersona = new Map<string, Tally>(PERSONAS.map((p) => [p.id, emptyTally()]));
const t0 = Date.now();
for (const sub of subs) {
  const tp = poolFor(sub.specialization, sub.id);
  if (!tp || tp.legacy) {
    console.error(`пропуск ${sub.id}: банк неполон`);
    continue;
  }
  const pool: PoolItem[] = tp.generators.map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade, format: g.format, limit: g.timeLimitSec }));
  const si = SUBCATEGORIES.indexOf(sub);
  PERSONAS.forEach((p, pi) => {
    const tally = byPersona.get(p.id)!;
    for (let r = 0; r < N; r++) {
      const base = deriveSeed(SEED * 7919 + si * 101 + pi, r);
      const rng = createRng(deriveSeed(base, 1));
      const thetaTrue = p.theta(rng);
      const out = runGrade(pool, p, thetaTrue, p.main(rng), deriveSeed(base, 2), rng);
      add(tally, out);
      if (out.stage.level === 'high' && out.grantable !== null) {
        for (const mode of ['unaided', 'repeat'] as const) {
          if (mode === 'repeat' && p.kind === 'honest') continue; // честному повтор «с помощью» не определён
          const c = runConfirm(pool, out.stage, out.shown, out.grantable, thetaTrue, p.confirm[mode](rng), deriveSeed(base, mode === 'unaided' ? 3 : 4), rng);
          const slot = mode === 'unaided' ? tally.confirmUnaided : tally.confirmRepeat;
          slot.n++;
          if (c.confirmed) slot.passed++;
        }
      }
    }
  });
}

// --- вывод ---------------------------------------------------------------------------------------------

const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)} %` : '—');
const r1 = (x: number, n: number) => (n ? Math.round((1000 * x) / n) / 10 : null);
console.log(`# Индекс честности на персонах: N = ${N} попыток на персону и подкатегорию, подкатегорий ${subs.length}, seed = ${SEED}, claim читеров = ${CLAIM_CHEAT}, σ времени = ${SIGMA}, шум честных: вкладка λ = ${NOISE_TABS}, вставка ${NOISE_PASTE}, копия ${NOISE_COPY}\n`);
console.log('| Персона | Попыток | low | medium | high | high при условии «есть что выдавать» | Выдано без проверки | Подтв. тест: сам | Подтв. тест: снова с помощью | Итог: категория выдана (без проверки или после подтверждающего «сам») | Ловушка |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of PERSONAS) {
  const t = byPersona.get(p.id)!;
  console.log(
    `| ${p.label} | ${t.n} | ${pct(t.low, t.n)} | ${pct(t.medium, t.n)} | ${pct(t.high, t.n)} | ${pct(t.blocking, t.grantable)} | ${pct(t.grantedUnchecked, t.n)} | ${t.confirmUnaided.n ? `${pct(t.confirmUnaided.passed, t.confirmUnaided.n)} (n = ${t.confirmUnaided.n})` : '—'} | ${p.kind === 'cheat' && t.confirmRepeat.n ? `${pct(t.confirmRepeat.passed, t.confirmRepeat.n)} (n = ${t.confirmRepeat.n})` : '—'} | ${pct(t.grantedUnchecked + t.confirmUnaided.passed, t.n)} | ${pct(t.canaryHit, t.n)} |`,
  );
}
console.log('\nСочетания групп при high:');
for (const p of PERSONAS) console.log(`- ${p.id}: ${Object.entries(byPersona.get(p.id)!.highGroups).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pct(v, byPersona.get(p.id)!.n)}`).join(', ') || 'нет'}`);
console.log('\nПричины (доля попыток, где есть причина):');
for (const p of PERSONAS) {
  const t = byPersona.get(p.id)!;
  console.log(`- ${p.id}: ${Object.entries(t.codes).map(([c, v]) => `${c} ${pct(v, t.n)}`).join(', ') || 'нет'}`);
}

if (JSON_OUT) {
  const report = {
    command: `npx tsx eval/test/integrity.ts ${args.join(' ')}`.trim(),
    generatedAt: new Date().toISOString(),
    params: { n: N, seed: SEED, noise: NOISE, sigma: SIGMA, noiseTabs: NOISE_TABS, noisePaste: NOISE_PASTE, noiseCopy: NOISE_COPY, claimCheat: CLAIM_CHEAT, subcategories: subs.map((s) => s.id) },
    personas: PERSONAS.map((p) => {
      const t = byPersona.get(p.id)!;
      return {
        id: p.id,
        label: p.label,
        kind: p.kind,
        claimed: p.claimed,
        attempts: t.n,
        sharePct: { low: r1(t.low, t.n), medium: r1(t.medium, t.n), high: r1(t.high, t.n), canaryHit: r1(t.canaryHit, t.n) },
        blockingOfGrantablePct: r1(t.blocking, t.grantable),
        grantedUncheckedPct: r1(t.grantedUnchecked, t.n),
        grantedFinalPct: r1(t.grantedUnchecked + t.confirmUnaided.passed, t.n),
        confirmUnaided: { n: t.confirmUnaided.n, passedPct: r1(t.confirmUnaided.passed, t.confirmUnaided.n) },
        confirmRepeatHelp: p.kind === 'cheat' ? { n: t.confirmRepeat.n, passedPct: r1(t.confirmRepeat.passed, t.confirmRepeat.n) } : null,
        meanLength: t.n ? Math.round((100 * t.length) / t.n) / 100 : null,
        highGroupsPct: Object.fromEntries(Object.entries(t.highGroups).map(([k, v]) => [k, r1(v, t.n)])),
        reasonSharePct: Object.fromEntries(Object.entries(t.codes).map(([c, v]) => [c, r1(v, t.n)])),
      };
    }),
  };
  writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nJSON: ${JSON_OUT}`);
}
console.log(`\nВремя прогона: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
