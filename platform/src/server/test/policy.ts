// Правила адаптивного теста (ADR-0002): пороги грейдов, выбор задания, остановка, решение.
// Все числа — ПРЕДЛОЖЕНИЕ: подобраны на симуляции (eval/test), на людях не оценены.
import type { Grade, Specialization } from '../types';

import type { TestGrade } from './types';

import { estimateTheta, information, probAbove, type Response, type ThetaEstimate } from './irt';
import { createRng } from './rng';

/**
 * Пороги грейдов на шкале θ — границы между популяциями, а не их центры.
 * Middle −0,1 — середина между синтетическими Junior N(−0,8; 0,5) и Middle N(0,6; 0,5) (eval/test/run.ts).
 * Junior −0,7 — по персонам (eval/test/personas.ts, ADR-0002, дополнение 10.10): прежний −1,5 лежал ниже
 * самого лёгкого задания банка (b = −1,5) и подтверждал Junior у «3 месяца курсов» (0,81) и у
 * верстальщика без JS (0,96); при −0,7 они ≈ 0,10 и 0,01, уверенный Junior — 0,90.
 * Зона Junior (0,6) шире SE остановки (0,4). Персоны — модели знаний агента, не люди; пороги — [В],
 * уточняются разметкой (docs/test-calibration.md).
 */
/** senior: +0.6 - предложение ADR-0003 (дополнение 10.10 16:15), политику Senior пишет directions; здесь только порог для калибровки. */
export const GRADE_CUT: Record<TestGrade, number> = { junior: -0.7, middle: -0.1, senior: 0.6 };

/** Грейд подтверждён, если P(θ > порог) ≥ 0,8. */
export const CONFIRM_PROB = 0.8;

/** Остановка: не раньше MIN, не позже MAX заданий; между ними — если решение уже уверенное. */
export const MIN_ITEMS = 7;
export const MAX_ITEMS = 10;
/** Уверенность для ранней остановки: P(θ > порог) ≥ 0,9 или ≤ 0,1. */
export const EARLY_STOP_PROB = 0.9;
/** Или точность достаточна: SE(θ) ≤ 0,4. */
export const SE_STOP = 0.4;

/** Randomesque: следующее задание — случайное из RANDOMESQUE лучших по информации (анти-утечка). */
export const RANDOMESQUE = 3;
/** Доля заданий одного утверждения в попытке ≤ 40 % (blueprint каталога § 7). */
export const MAX_SHARE_PER_CATALOG = 0.4;

export interface SelectableTemplate {
  id: string;
  a: number;
  b: number;
  catalogIds: string[];
  grade: TestGrade;
  /** Сколько раз шаблон показан за всё время (экспозиция). */
  exposure?: number;
}

export interface SelectionState {
  /** Уже показанные шаблоны попытки (по порядку). */
  shown: readonly SelectableTemplate[];
  theta: number;
  /** seed попытки + номер задания — детерминированный randomesque. */
  seed: number;
}

/**
 * Выбор следующего шаблона: кандидаты — не показанные в попытке и не нарушающие долю
 * утверждения; ранжирование по информации Фишера при текущей θ̂; из RANDOMESQUE лучших —
 * один по seed. При равной информации предпочитается менее экспонированный.
 */
export function selectNext(pool: readonly SelectableTemplate[], state: SelectionState): SelectableTemplate | null {
  const shownIds = new Set(state.shown.map((t) => t.id));
  const counts = new Map<string, number>();
  for (const t of state.shown) for (const c of t.catalogIds) counts.set(c, (counts.get(c) ?? 0) + 1);
  const limit = Math.max(1, Math.floor(MAX_ITEMS * MAX_SHARE_PER_CATALOG));
  const eligible = pool.filter((t) => !shownIds.has(t.id) && t.catalogIds.every((c) => (counts.get(c) ?? 0) < limit));
  const candidates = eligible.length > 0 ? eligible : pool.filter((t) => !shownIds.has(t.id));
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((t) => ({ t, info: information(state.theta, t) }))
    .sort((x, y) => y.info - x.info || (x.t.exposure ?? 0) - (y.t.exposure ?? 0) || x.t.id.localeCompare(y.t.id));
  const top = ranked.slice(0, RANDOMESQUE);
  return createRng(state.seed).pick(top).t;
}

export interface StopDecision {
  stop: boolean;
  reason: StopReason | null;
}

/** Причина остановки. junior_resolved — дозадавание Junior дало уверенный ответ (P ≥ 0,9 или ≤ 0,1). */
export type StopReason = 'max_items' | 'confident' | 'precise' | 'junior_resolved';

/** Правило остановки по текущей оценке и порогу заявленного грейда. */
export interface StopLimits {
  min: number;
  max: number;
}

export function shouldStop(
  answered: number,
  est: ThetaEstimate,
  grade: TestGrade,
  poolExhausted = false,
  limits: StopLimits = { min: MIN_ITEMS, max: MAX_ITEMS },
): StopDecision {
  if (answered >= limits.max || (poolExhausted && answered > 0)) return { stop: true, reason: 'max_items' };
  if (answered < limits.min) return { stop: false, reason: null };
  const p = probAbove(est, GRADE_CUT[grade]);
  if (p >= EARLY_STOP_PROB || p <= 1 - EARLY_STOP_PROB) return { stop: true, reason: 'confident' };
  if (est.se <= SE_STOP) return { stop: true, reason: 'precise' };
  return { stop: false, reason: null };
}

// ---------------------------------------------------------------------------
// Дозадавание Junior (R-C-08, решение владельца 10.10, ADR-0002 «Дозадавание Junior-заданий»)
// ---------------------------------------------------------------------------

/**
 * Сколько Junior-заданий можно дозадать после основной фазы, если Junior по ней неуверенный.
 * Заявлен Middle: в Middle-тесте всего ~4 Junior-задания, и P(θ > −0,7) у решившего их все часто
 * не дотягивает до CONFIRM_PROB — «Junior в 1 клик» срабатывал в 51–63 %. Заявлен Junior (решение
 * владельца 10.10, adr-0002-v3): основная фаза останавливается по SE или MAX_ITEMS, перемешав Junior- и
 * Middle-задания, и идеальный Junior (все Junior верно, Middle неверно) подтверждался в 52–68 %.
 * Фактически дозадаётся не больше, чем осталось непоказанных Junior-шаблонов (6 на специализацию).
 */
export const JUNIOR_PROBE_MAX = 3;
/** Общий потолок заданий попытки: основная фаза + дозадавание. */
export const MAX_ITEMS_TOTAL = MAX_ITEMS + JUNIOR_PROBE_MAX;

/** Фаза попытки: основная (по порогу заявленного грейда) или дозадавание Junior. */
export type AttemptPhase = 'main' | 'junior_probe';

export interface StepInput {
  /** Все шаблоны специализации. */
  pool: readonly SelectableTemplate[];
  /** Показанные и отвеченные шаблоны попытки, по порядку (shown[i] ↔ responses[i]). */
  shown: readonly SelectableTemplate[];
  responses: readonly Response[];
  grade: TestGrade;
  /**
   * Разрешено ли дозадавание (по умолчанию да). false — только основная фаза: так считаются попытки
   * другой версии политики (POLICY_VERSION), чтобы они не меняли длину и фазу задним числом.
   */
  probe?: boolean;
}

export interface Step extends StopDecision {
  /** Фаза следующего задания (или фаза, в которой попытка остановилась). */
  phase: AttemptPhase;
  /** На каком задании остановилась основная фаза; null — она ещё идёт. */
  mainLength: number | null;
  /** Потолок заданий для текущей фазы (для прогресса в UI). */
  maxItems: number;
}

/** P(Junior) в зоне неуверенности: не подтверждает (< CONFIRM_PROB) и не отвергает уверенно (> 1 − CONFIRM_PROB). */
export function juniorUncertain(pJunior: number): boolean {
  return pJunior > 1 - CONFIRM_PROB && pJunior < CONFIRM_PROB;
}

/**
 * Нужна ли фаза дозадавания после остановки основной: заявленный грейд не подтверждён
 * (P(θ > порог заявленного) < CONFIRM_PROB — ранняя остановка «вниз», по SE или по MAX_ITEMS),
 * P(Junior) неуверенная (0,2…0,8) и есть непоказанные Junior-шаблоны. Для заявки Junior первое
 * условие совпадает со вторым (порог заявленного — порог Junior); для Middle — отдельная проверка.
 */
export function needsJuniorProbe(est: ThetaEstimate, grade: TestGrade, juniorLeft: number): boolean {
  if (juniorLeft <= 0) return false;
  if (grade === 'middle' && probAbove(est, GRADE_CUT.middle) >= CONFIRM_PROB) return false;
  return juniorUncertain(probAbove(est, GRADE_CUT.junior));
}

/** Пул для выбора следующего задания в фазе: в дозадавании — только Junior-шаблоны. */
export function phasePool<T extends SelectableTemplate>(pool: readonly T[], phase: AttemptPhase): readonly T[] {
  return phase === 'junior_probe' ? pool.filter((t) => t.grade === 'junior') : pool;
}

/**
 * Решение после очередного ответа: остановить попытку или дать следующее задание и в какой фазе.
 * Чистая функция от ответов (фаза не хранится в БД, а выводится повтором shouldStop по префиксам):
 * те же ответы → та же фаза и та же остановка.
 *
 * 1. Основная фаза — shouldStop по порогу заявленного грейда (MIN_ITEMS…MAX_ITEMS).
 * 2. Остановилась, и needsJuniorProbe (заявка Middle или Junior) → фаза junior_probe: до JUNIOR_PROBE_MAX Junior-заданий
 *    (randomesque и лимит доли утверждения — как в основной), стоп, как только
 *    P(Junior) ≥ EARLY_STOP_PROB или ≤ 1 − EARLY_STOP_PROB, исчерпан лимит или Junior-шаблоны.
 * Решение о грейде (decide) берёт все ответы попытки: адаптивный выбор заданий не смещает
 * апостериорную оценку θ, дозаданные ответы — такие же наблюдения.
 */
export function nextStep(input: StepInput, limits: StopLimits = { min: MIN_ITEMS, max: MAX_ITEMS }): Step {
  const { pool, shown, responses, grade, probe: probeAllowed = true } = input;
  const n = responses.length;
  const juniorTotal = pool.filter((t) => t.grade === 'junior').length;
  const juniorShown = (k: number) => shown.slice(0, k).filter((t) => t.grade === 'junior').length;

  // Где остановилась основная фаза (повтор по префиксам ответов).
  let mainLength: number | null = null;
  let mainStop: StopDecision = { stop: false, reason: null };
  for (let k = 1; k <= n; k++) {
    const d = shouldStop(k, estimateTheta(responses.slice(0, k)), grade, k >= pool.length, limits);
    if (d.stop) {
      mainLength = k;
      mainStop = d;
      break;
    }
  }
  if (mainLength === null) return { stop: false, reason: null, phase: 'main', mainLength: null, maxItems: limits.max };

  const atMain = estimateTheta(responses.slice(0, mainLength));
  const juniorLeft = juniorTotal - juniorShown(mainLength);
  if (!probeAllowed || !needsJuniorProbe(atMain, grade, juniorLeft)) {
    return { ...mainStop, stop: true, phase: 'main', mainLength, maxItems: limits.max };
  }

  // Потолок фазы — сколько реально можно дозадать: не больше оставшихся Junior-шаблонов (на backend
  // их часто 2), иначе экран обещал бы 13 заданий, а тест кончался на 12.
  const probeMax = mainLength + Math.min(JUNIOR_PROBE_MAX, juniorLeft);
  const probeAnswered = n - mainLength;
  const probe = (stop: boolean, reason: StopReason | null): Step => ({ stop, reason, phase: 'junior_probe', mainLength, maxItems: probeMax });
  if (probeAnswered > 0) {
    const pJunior = probAbove(estimateTheta(responses), GRADE_CUT.junior);
    if (pJunior >= EARLY_STOP_PROB || pJunior <= 1 - EARLY_STOP_PROB) return probe(true, 'junior_resolved');
  }
  if (probeAnswered >= JUNIOR_PROBE_MAX || juniorShown(n) >= juniorTotal) return probe(true, 'max_items');
  return probe(false, null);
}

export interface GradeDecision {
  theta: number;
  se: number;
  pPass: number;
  pJunior: number;
  confirmed: boolean;
  /** Заявлен Middle, не подтверждён, но Junior подтверждается по той же попытке. */
  juniorOffered: boolean;
}

/** Решение о грейде по ответам (чистое: те же ответы → то же решение). */
export function decide(responses: readonly Response[], grade: TestGrade, confirmProb: number = CONFIRM_PROB): GradeDecision {
  const est = estimateTheta(responses);
  const pPass = probAbove(est, GRADE_CUT[grade]);
  const pJunior = probAbove(est, GRADE_CUT.junior);
  const confirmed = responses.length > 0 && pPass >= confirmProb;
  return {
    theta: est.theta,
    se: est.se,
    pPass,
    pJunior,
    confirmed,
    juniorOffered: grade === 'middle' && !confirmed && responses.length > 0 && pJunior >= confirmProb,
  };
}

export function specLabel(s: Specialization): string {
  return s === 'backend' ? 'Backend' : 'Frontend';
}

export function gradeLabel(g: Grade): string {
  return g === 'junior' ? 'Junior' : 'Middle';
}

/** Объяснение итога кандидату: без θ-жаргона, с вероятностью и числом решённых. */
export function explainDecision(d: GradeDecision, grade: Grade, answered: number, correct: number): string {
  const pct = Math.round(d.pPass * 100);
  const base = `Решено ${correct} из ${answered}. Уверенность, что уровень не ниже ${gradeLabel(grade)}: ${pct}% (нужно не меньше ${Math.round(CONFIRM_PROB * 100)}%).`;
  if (d.confirmed) return `${base} Грейд ${gradeLabel(grade)} подтверждён.`;
  if (d.juniorOffered) {
    return `${base} Middle не подтверждён, но задания уровня Junior решены уверенно (${Math.round(d.pJunior * 100)}%): можно подтвердить Junior по этой же попытке.`;
  }
  return `${base} Грейд ${gradeLabel(grade)} не подтверждён. Уже подтверждённая категория не снимается.`;
}
