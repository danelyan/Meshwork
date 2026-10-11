// Данные страницы /method «Как устроена проверка» для жюри: константы политики теста, информационная функция банка
// подкатегории и агрегат прогонов simulate() на смоделированных кандидатах. Без БД и LLM, детерминированно.
// Числа политики и весов не дублируются — читаются из policy.ts и weights.ts.
import { GRADES, type Grade } from '@/lib/grades';
import { getSubcategory } from '@/lib/directions';
import { poolFor } from '@/server/test/generators';
import { GRID, GRID_MAX, GRID_MIN, information, testInformation, type ItemParams } from '@/server/test/irt';
import {
  CONFIRM_PROB,
  EARLY_STOP_PROB,
  GRADE_CUT,
  JUNIOR_PROBE_MAX,
  MAX_COMMON_SHARE,
  MAX_ITEMS,
  MAX_SHARE_PER_CATALOG,
  MIDDLE_PROBE_MAX,
  MIN_ITEMS,
  POLICY_VERSION,
  RANDOMESQUE,
  SE_STOP,
  SENIOR_MAIN_MAX,
  START_THETA,
} from '@/server/test/policy';

import { simulate } from './simulator';

export function methodPolicy() {
  return {
    version: POLICY_VERSION,
    startTheta: { ...START_THETA },
    randomesque: RANDOMESQUE,
    minItems: MIN_ITEMS,
    maxItems: MAX_ITEMS,
    earlyStop: EARLY_STOP_PROB,
    seStop: SE_STOP,
    confirmProb: CONFIRM_PROB,
    juniorProbeMax: JUNIOR_PROBE_MAX,
    middleProbeMax: MIDDLE_PROBE_MAX,
    seniorMainMax: SENIOR_MAIN_MAX,
    maxCommonShare: MAX_COMMON_SHARE,
    maxSharePerCatalog: MAX_SHARE_PER_CATALOG,
    grid: { size: GRID.length, min: GRID_MIN, max: GRID_MAX },
    cuts: { ...GRADE_CUT },
  };
}
export type MethodPolicy = ReturnType<typeof methodPolicy>;

/** Сетка графика: θ от −3 до 3 с шагом 0,1. */
export const INFO_THETAS: readonly number[] = Array.from({ length: 61 }, (_, i) => Number((-3 + i * 0.1).toFixed(1)));

export interface BankInformation {
  subcategoryId: string;
  thetas: readonly number[];
  /** I(θ) суммы по заданиям банка каждого грейда (свои семейства и общие). */
  byGrade: Record<Grade, number[]>;
  /** Сколько заданий каждого грейда в банке. */
  counts: Record<Grade, number>;
  /**
   * Потолок точности одной попытки: при каждом θ — сумма информации MAX_ITEMS самых информативных заданий банка
   * (адаптивный тест длиной MAX_ITEMS в идеале). SE = 1/√I.
   */
  best: number[];
  bestSe: number[];
  /** θ, где потолок информации максимален (тест различает лучше всего). */
  peakTheta: number;
  /** Где SE потолка ≤ SE_STOP: [от, до] или null. */
  preciseRange: [number, number] | null;
}

/** Сумма информации k самых информативных заданий при θ. */
export function topInformation(theta: number, items: readonly ItemParams[], k: number): number {
  return items
    .map((it) => information(theta, it))
    .sort((x, y) => y - x)
    .slice(0, k)
    .reduce((s, v) => s + v, 0);
}

function bankOf(subcategoryId: string) {
  const sub = getSubcategory(subcategoryId);
  const pool = sub ? poolFor(sub.specialization, sub.id, { common: true }) : null;
  return pool ? pool.generators : null;
}

export function bankInformation(subcategoryId: string): BankInformation | null {
  const bank = bankOf(subcategoryId);
  if (!bank) return null;
  const items = (g: Grade) => bank.filter((t) => t.grade === g).map((t) => ({ a: t.a, b: t.b }));
  const byGrade = Object.fromEntries(GRADES.map((g) => [g, INFO_THETAS.map((th) => testInformation(th, items(g)))])) as Record<Grade, number[]>;
  const counts = Object.fromEntries(GRADES.map((g) => [g, items(g).length])) as Record<Grade, number>;
  const all = bank.map((t) => ({ a: t.a, b: t.b }));
  const best = INFO_THETAS.map((th) => topInformation(th, all, MAX_ITEMS));
  const bestSe = best.map((i) => (i > 0 ? 1 / Math.sqrt(i) : Infinity));
  let peak = 0;
  for (let i = 1; i < best.length; i++) if (best[i]! > best[peak]!) peak = i;
  const precise = INFO_THETAS.filter((_, i) => bestSe[i]! <= SE_STOP);
  return {
    subcategoryId,
    thetas: INFO_THETAS,
    byGrade,
    counts,
    best,
    bestSe,
    peakTheta: INFO_THETAS[peak]!,
    preciseRange: precise.length ? [precise[0]!, precise[precise.length - 1]!] : null,
  };
}

/** Смоделированные кандидаты: «истинная» θ в середине зоны своего грейда, заявка — свой грейд (новичок заявляет Junior). */
export const PERSONAS: readonly { id: string; title: string; theta: number; claimed: Grade; expect: string }[] = [
  { id: 'novice', title: 'Новичок', theta: -1.3, claimed: 'junior', expect: 'Junior не должен подтвердиться' },
  { id: 'junior', title: 'Junior', theta: -0.4, claimed: 'junior', expect: 'Junior должен подтвердиться' },
  { id: 'middle', title: 'Middle', theta: 0.35, claimed: 'middle', expect: 'Middle должен подтвердиться' },
  { id: 'senior', title: 'Senior', theta: 1.3, claimed: 'senior', expect: 'Senior должен подтвердиться' },
];

/** Прогонов на кандидата (seed 1…N). 4 × 200 прогонов — около 0,3 с на подкатегорию. */
export const SIM_RUNS = 200;

export interface PersonaStats {
  id: string;
  title: string;
  theta: number;
  claimed: Grade;
  expect: string;
  runs: number;
  meanLength: number;
  minLength: number;
  maxLength: number;
  meanSe: number;
  /** Доля прогонов, где заявленный грейд подтверждён. */
  confirmRate: number;
  /** Доля вердиктов: грейд или null («не подтверждено / ниже Junior»). */
  verdicts: Record<Grade | 'none', number>;
  /** Средняя |θ̂ − θ|. */
  meanAbsError: number;
  /** Грейд по «истинной» θ и порогам GRADE_CUT; none — ниже Junior. */
  truth: Grade | 'none';
  /** Доля вердиктов выше истинного грейда (завышение) и ниже (занижение). */
  overRate: number;
  underRate: number;
}

const RANK: Record<Grade | 'none', number> = { none: 0, junior: 1, middle: 2, senior: 3 };

/** Грейд по θ: старший, чей порог θ превышает; ниже порога Junior — none. */
export function gradeOfTheta(theta: number): Grade | 'none' {
  let out: Grade | 'none' = 'none';
  for (const g of GRADES) if (theta > GRADE_CUT[g]) out = g;
  return out;
}

const cache = new Map<string, PersonaStats[]>();

/** Агрегат по SIM_RUNS прогонам simulate() на каждого кандидата. Детерминирован: seed = 1…runs. Кэш по подкатегории. */
export function simulatedCandidates(subcategoryId: string, runs: number = SIM_RUNS): PersonaStats[] | null {
  const key = `${subcategoryId}:${runs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = computeSimulatedCandidates(subcategoryId, runs);
  if (out) cache.set(key, out);
  return out;
}

/** То же без кэша. */
export function computeSimulatedCandidates(subcategoryId: string, runs: number = SIM_RUNS): PersonaStats[] | null {
  if (!bankOf(subcategoryId)) return null;
  return PERSONAS.map((p) => {
    let len = 0;
    let se = 0;
    let err = 0;
    let confirmed = 0;
    let minLength = Infinity;
    let maxLength = 0;
    const verdicts: Record<Grade | 'none', number> = { none: 0, junior: 0, middle: 0, senior: 0 };
    for (let seed = 1; seed <= runs; seed++) {
      const r = simulate({ subcategoryId, claimed: p.claimed, theta: p.theta, mode: 'ideal', seed });
      len += r.length;
      se += r.se;
      err += Math.abs(r.theta - p.theta);
      if (r.confirmed) confirmed++;
      minLength = Math.min(minLength, r.length);
      maxLength = Math.max(maxLength, r.length);
      verdicts[r.grade ?? 'none']++;
    }
    for (const k of Object.keys(verdicts) as (Grade | 'none')[]) verdicts[k] /= runs;
    const truth = gradeOfTheta(p.theta);
    const keys = Object.keys(verdicts) as (Grade | 'none')[];
    return {
      truth,
      overRate: keys.filter((k) => RANK[k] > RANK[truth]).reduce((s, k) => s + verdicts[k], 0),
      underRate: keys.filter((k) => RANK[k] < RANK[truth]).reduce((s, k) => s + verdicts[k], 0),
      ...p,
      runs,
      meanLength: len / runs,
      minLength,
      maxLength,
      meanSe: se / runs,
      confirmRate: confirmed / runs,
      verdicts,
      meanAbsError: err / runs,
    };
  });
}
