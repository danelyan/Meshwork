// Симулятор адаптивного теста для жюри (/simulator): виртуальный кандидат с заданной «истинной» θ проходит тот же
// движок, что и боевой тест, шаг за шагом. Без БД и без LLM, детерминированно по seed. Движок (irt/policy/rng/генераторы)
// не меняется – здесь только цикл, повторяющий service.ts (pushNextItem + nextStep) и eval/test/run.ts (runAttempt).
// Режимы ответов взяты из eval/test/run.ts: ideal – 2PL по экспертным a, b; noise – b каждого показа с шумом σ = 0,2
// («instance» в run.ts); leak – кандидат знает трюк по 30 % семейств (+0,3 к P, «утечка», атака из run.ts).
// Угадывания (c-параметра) в движке и в eval нет – режима «с угадыванием» нет сознательно.
import { z } from 'zod';

import { getSubcategory, SPEC_LABEL, SUBCATEGORIES } from '@/lib/directions';
import { GRADES, type Grade } from '@/lib/grades';
import { getGenerator, poolFor } from '@/server/test/generators';
import { estimateTheta, probCorrect, type Response } from '@/server/test/irt';
import {
  decide,
  GRADE_CUT,
  nextStep,
  phasePool,
  POLICY_VERSION,
  rulesFor,
  selectNext,
  START_THETA,
  type AttemptPhase,
  type SelectableTemplate,
  type StopReason,
} from '@/server/test/policy';
import { createRng, deriveSeed, type Rng } from '@/server/test/rng';

export const SIM_MODES = ['ideal', 'noise', 'leak'] as const;
export type SimMode = (typeof SIM_MODES)[number];

export const SIM_LIMITS = { bodyBytes: 2048, thetaMin: -3, thetaMax: 3, seedMax: 0x7fffffff } as const;

/** Параметры режимов – как в eval/test/run.ts (NOISE, доля шаблонов с трюком и прибавка к P). */
const NOISE_SD = 0.2;
const LEAK_SHARE = 0.3;
const LEAK_BONUS = 0.3;

export const SimInput = z.object({
  subcategoryId: z.string().min(1).max(64),
  claimed: z.enum(GRADES),
  theta: z.number().min(SIM_LIMITS.thetaMin).max(SIM_LIMITS.thetaMax),
  mode: z.enum(SIM_MODES).default('ideal'),
  seed: z.number().int().min(0).max(SIM_LIMITS.seedMax).default(1),
});
export type SimInput = z.input<typeof SimInput>;

export interface SimStep {
  /** С 1. */
  n: number;
  templateId: string;
  title: string;
  itemGrade: Grade;
  a: number;
  b: number;
  phase: AttemptPhase;
  /** Вероятность верного ответа виртуального кандидата (по модели режима). */
  pModel: number;
  correct: boolean;
  /** Оценка после шага. */
  theta: number;
  se: number;
}

export interface SimResult {
  input: { subcategoryId: string; claimed: Grade; theta: number; mode: SimMode; seed: number };
  policyVersion: string;
  steps: SimStep[];
  /** Оценка до первого ответа (априорная). */
  start: { theta: number; se: number };
  /** Заявленный грейд подтверждён (P ≥ порога подтверждения). */
  confirmed: boolean;
  /** Не подтверждён, но подтверждается грейд ниже по той же попытке. */
  offeredGrade: Grade | null;
  /** Грейд, который выносит тест: заявленный, предложенный ниже или null («ниже Junior» / не подтверждено). */
  grade: Grade | null;
  pPass: number;
  theta: number;
  se: number;
  stopReason: StopReason | 'pool_end';
  length: number;
  correctCount: number;
  /** Порог θ каждого грейда (для графика). */
  cuts: Record<Grade, number>;
}

export interface SimSubcategory {
  id: string;
  specialization: string;
  specializationTitle: string;
  title: string;
}

/** Подкатегории, по которым есть тест (полный банк). Берутся из справочника и реестра генераторов, не хардкодятся. */
export function simulatorSubcategories(): SimSubcategory[] {
  return SUBCATEGORIES.filter((s) => poolFor(s.specialization, s.id, { common: true }) !== null).map((s) => ({
    id: s.id,
    specialization: s.specialization,
    specializationTitle: SPEC_LABEL[s.specialization],
    title: s.title,
  }));
}

export class SimInputError extends Error {}

/** Нормальное распределение (Бокс–Мюллер) на детерминированном rng – как в eval/test/run.ts. */
function gauss(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function parseSimInput(raw: unknown): z.output<typeof SimInput> {
  const r = SimInput.safeParse(raw);
  if (!r.success) throw new SimInputError(r.error.issues.map((i) => `${i.path.join('.') || 'тело'}: ${i.message}`).join('; '));
  return r.data;
}

/** Один прогон: тот же цикл, что в service.ts и eval/test/run.ts (runAttempt). */
export function simulate(raw: unknown): SimResult {
  const input = parseSimInput(raw);
  const sub = getSubcategory(input.subcategoryId);
  const pool0 = sub ? poolFor(sub.specialization, sub.id, { common: true }) : null;
  if (!sub || !pool0) throw new SimInputError('Для этой подкатегории теста пока нет');
  const pool: SelectableTemplate[] = pool0.generators.map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade, common: Boolean(g.shared) }));
  const rules = rulesFor(POLICY_VERSION);
  const rng = createRng(deriveSeed(input.seed, 9000));
  const trick: Set<string> =
    input.mode === 'leak' ? new Set(createRng(deriveSeed(input.seed, 9100)).sample(pool, Math.round(pool.length * LEAK_SHARE)).map((t) => t.id)) : new Set();

  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  const steps: SimStep[] = [];
  let phase: AttemptPhase = 'main';
  let stopReason: SimResult['stopReason'] = 'pool_end';
  for (let index = 0; index < pool.length; index++) {
    const theta = responses.length ? estimateTheta(responses).theta : START_THETA[input.claimed];
    const next = selectNext(phasePool(pool, phase, input.claimed), { shown, theta, seed: deriveSeed(input.seed, 1000 + index) });
    if (!next) break;
    shown.push(next);
    const b = next.b + (input.mode === 'noise' ? NOISE_SD * gauss(rng) : 0);
    let p = probCorrect(input.theta, { a: next.a, b });
    if (trick.has(next.id)) p = Math.min(1, p + LEAK_BONUS);
    const correct = rng.next() < p;
    responses.push({ a: next.a, b: next.b, correct });
    const est = estimateTheta(responses);
    steps.push({
      n: index + 1,
      templateId: next.id,
      title: getGenerator(next.id)?.title ?? next.id,
      itemGrade: next.grade,
      a: next.a,
      b: next.b,
      phase,
      pModel: p,
      correct,
      theta: est.theta,
      se: est.se,
    });
    const step = nextStep({ pool, shown, responses, grade: input.claimed }, rules);
    if (step.stop) {
      stopReason = step.reason ?? 'max_items';
      break;
    }
    phase = step.phase;
  }
  const d = decide(responses, input.claimed);
  const prior = estimateTheta([]);
  return {
    input: { subcategoryId: input.subcategoryId, claimed: input.claimed, theta: input.theta, mode: input.mode, seed: input.seed },
    policyVersion: POLICY_VERSION,
    steps,
    start: { theta: prior.theta, se: prior.se },
    confirmed: d.confirmed,
    offeredGrade: d.offeredGrade,
    grade: d.confirmed ? input.claimed : d.offeredGrade,
    pPass: d.pPass,
    theta: d.theta,
    se: d.se,
    stopReason,
    length: responses.length,
    correctCount: responses.filter((r) => r.correct).length,
    cuts: { ...GRADE_CUT },
  };
}
