// Правила адаптивного теста (ADR-0002): пороги грейдов, выбор задания, остановка, решение.
// Все числа — ПРЕДЛОЖЕНИЕ: подобраны на симуляции (eval/test), на людях не оценены.
import { SPEC_LABEL } from '@/lib/directions';
import type { Grade, Specialization } from '../types';

import { estimateTheta, information, probAbove, type Response, type ThetaEstimate } from './irt';
import { createRng } from './rng';
import { GRADE_LABEL, lowerGrade } from '@/lib/grades';

/**
 * Порог Senior (ADR 0003, дополнение 10.10 16:15; ADR-0002 «Senior и пул по подкатегориям»): ПРЕДЛОЖЕНИЕ +0,8.
 * Предложение ADR было +0,6. Пока основная фаза Senior шла по всему пулу, порог решал всё: при +0,6 персоны на
 * подкатегорию (eval/test/subcategory-personas.ts) давали ложный Senior у Middle до 0,14, у «Middle с одной слабой
 * темой» до 0,35. С основной фазой только по Senior-пулу (mainPool) ложный Senior 0,00 и Senior 1,00 при любом пороге
 * +0,6…+1,0 во всех пяти подкатегориях AI. Оставлено +0,8: запас над Middle (−0,1) — 0,9, и при 4 из 4 верных
 * Senior-ответах примерно в половине попыток добирается одно Middle-задание (4,5 задания вместо 4) — больше
 * наблюдений на решение, которое видит работодатель. Senior-задания банка — b 1,0…1,7.
 */
export const SENIOR_CUT = 0.8;

/**
 * Пороги грейдов на шкале θ — границы между популяциями, а не их центры.
 * Middle −0,1 — середина между синтетическими Junior N(−0,8; 0,5) и Middle N(0,6; 0,5) (eval/test/run.ts).
 * Junior −0,7 — по персонам (eval/test/personas.ts, ADR-0002, дополнение 10.10): прежний −1,5 лежал ниже
 * самого лёгкого задания банка (b = −1,5) и подтверждал Junior у «3 месяца курсов» (0,81) и у
 * верстальщика без JS (0,96); при −0,7 они ≈ 0,10 и 0,01, уверенный Junior — 0,90.
 * Зона Junior (0,6) шире SE остановки (0,4). Персоны — модели знаний агента, не люди; пороги — [В],
 * уточняются разметкой (docs/test-calibration.md).
 */
export const GRADE_CUT: Record<Grade, number> = { junior: -0.7, middle: -0.1, senior: SENIOR_CUT };

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

/**
 * Доля общих семейств (TaskGenerator.shared) в попытке ≤ 30 % (ADR 0003, дополнение 11.10, ПРЕДЛОЖЕНИЕ): тест остаётся
 * про подкатегорию. Правило префиксное — общее задание можно показать, только если после него в каждом префиксе попытки
 * общих не больше floor(MAX_COMMON_SHARE × длина): первое общее — не раньше 4-го задания, при 10 — не больше 3. Так
 * доля соблюдена при любой длине (ранняя остановка, дозадавание, подтверждающий тест). В фазах дозадавания общих нет.
 */
export const MAX_COMMON_SHARE = 0.3;

/** Можно ли показать ещё одно общее задание после `shown`. */
export function commonAllowed(shown: readonly SelectableTemplate[]): boolean {
  const used = shown.filter((t) => t.common).length;
  return used + 1 <= Math.floor(MAX_COMMON_SHARE * (shown.length + 1));
}

/**
 * Сколько заданий реально достижимо из пула при префиксном лимите общих: все свои + столько общих, сколько допускает
 * MAX_COMMON_SHARE (общие ставятся в конец — так их помещается больше всего). Для остановки по исчерпанию пула.
 */
export function reachableSize(pool: readonly SelectableTemplate[]): number {
  const own = pool.filter((t) => !t.common).length;
  const common = pool.length - own;
  let used = 0;
  while (used < common && used + 1 <= Math.floor(MAX_COMMON_SHARE * (own + used + 1))) used++;
  return own + used;
}

export interface SelectableTemplate {
  id: string;
  a: number;
  b: number;
  catalogIds: string[];
  grade: Grade;
  /** Сколько раз шаблон показан за всё время (экспозиция). */
  exposure?: number;
  /** Общее семейство (TaskGenerator.shared): доля в попытке ≤ MAX_COMMON_SHARE. */
  common?: boolean;
}

export interface SelectionState {
  /** Уже показанные шаблоны попытки (по порядку). */
  shown: readonly SelectableTemplate[];
  theta: number;
  /** seed попытки + номер задания — детерминированный randomesque. */
  seed: number;
  /**
   * Шаблоны, которые кандидат уже видел в прошлых попытках того же пула (с разбором и ключом после попытки).
   * Их информация при ранжировании умножается на SEEN_BEFORE_WEIGHT: пересдача по возможности идёт на других
   * семействах, а не на тех же с другими числами. Не передано — как до v5.
   */
  seenBefore?: ReadonlySet<string>;
}

/** Вес информации шаблона, виденного в прошлой попытке (у Скаута ×0,5; у Рекрута 2 — исключение). ПРЕДЛОЖЕНИЕ. */
export const SEEN_BEFORE_WEIGHT = 0.5;

/**
 * Выбор следующего шаблона: кандидаты — не показанные в попытке и не нарушающие долю
 * утверждения; ранжирование по информации Фишера при текущей θ̂; из RANDOMESQUE лучших —
 * один по seed. При равной информации предпочитается менее экспонированный.
 */
export function selectNext(pool: readonly SelectableTemplate[], state: SelectionState): SelectableTemplate | null {
  // Лимит доли общих — жёсткий (не ослабляется фолбэком по утверждениям ниже).
  const allowed = commonAllowed(state.shown) ? pool : pool.filter((t) => !t.common);
  const shownIds = new Set(state.shown.map((t) => t.id));
  const counts = new Map<string, number>();
  for (const t of state.shown) for (const c of t.catalogIds) counts.set(c, (counts.get(c) ?? 0) + 1);
  const limit = Math.max(1, Math.floor(MAX_ITEMS * MAX_SHARE_PER_CATALOG));
  const eligible = allowed.filter((t) => !shownIds.has(t.id) && t.catalogIds.every((c) => (counts.get(c) ?? 0) < limit));
  const candidates = eligible.length > 0 ? eligible : allowed.filter((t) => !shownIds.has(t.id));
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((t) => ({ t, info: information(state.theta, t) * (state.seenBefore?.has(t.id) ? SEEN_BEFORE_WEIGHT : 1) }))
    .sort((x, y) => y.info - x.info || (x.t.exposure ?? 0) - (y.t.exposure ?? 0) || x.t.id.localeCompare(y.t.id));
  const top = ranked.slice(0, RANDOMESQUE);
  return createRng(state.seed).pick(top).t;
}

export interface StopDecision {
  stop: boolean;
  reason: StopReason | null;
}

/**
 * Причина остановки. junior_resolved — дозадавание Junior дало уверенный ответ (P ≥ 0,9 или ≤ 0,1);
 * middle_resolved — то же для дозадавания Middle при заявке Senior.
 */
export type StopReason = 'max_items' | 'confident' | 'precise' | 'junior_resolved' | 'middle_resolved';

/** Правило остановки по текущей оценке и порогу заявленного грейда. */
export interface StopLimits {
  min: number;
  max: number;
  /**
   * Остановка по точности: SE(θ) ≤ seStop. undefined — SE_STOP (как до v5); null — выключена (классификационная
   * остановка: стоп только при уверенном решении P ≥ EARLY_STOP_PROB или ≤ 1 − EARLY_STOP_PROB, иначе до max).
   */
  seStop?: number | null;
  /** Уверенность ранней остановки основной фазы; undefined — EARLY_STOP_PROB (0,9). */
  earlyStop?: number;
}

export function shouldStop(
  answered: number,
  est: ThetaEstimate,
  grade: Grade,
  poolExhausted = false,
  limits: StopLimits = { min: MIN_ITEMS, max: MAX_ITEMS },
): StopDecision {
  if (answered >= limits.max || (poolExhausted && answered > 0)) return { stop: true, reason: 'max_items' };
  if (answered < limits.min) return { stop: false, reason: null };
  const p = probAbove(est, GRADE_CUT[grade]);
  const early = limits.earlyStop ?? EARLY_STOP_PROB;
  if (p >= early || p <= 1 - early) return { stop: true, reason: 'confident' };
  const seStop = limits.seStop === undefined ? SE_STOP : limits.seStop;
  if (seStop !== null && est.se <= seStop) return { stop: true, reason: 'precise' };
  return { stop: false, reason: null };
}

/**
 * Версия политики попытки (TestAttempt.policyVersion) и её правила остановки. Попытка доигрывается по правилам
 * своей версии: смена правил не меняет длину и фазу уже начатых попыток задним числом.
 * v2 (10.10): порог Junior −0,7 и дозадавание Junior-заданий при заявке Middle (ADR-0002, дополнения 10.10).
 * v3 (10.10): дозадавание и при заявке Junior (ADR-0002, «Заявка Junior»).
 * v4 (10.10): тест на подкатегорию — пул попытки только из семейств подкатегории кандидата
 * (ADR 0003, дополнение 10.10 15:50) и грейд Senior: порог +0,6, старт с Senior-заданий, дозадавание Middle,
 * Middle в один клик (ADR 0003, дополнение 10.10 16:15; ADR-0002 «Senior и пул по подкатегориям»).
 * v5 (11.10): ротация семейств между попытками кандидата — шаблоны прошлых попыток того же пула ранжируются с весом
 * SEEN_BEFORE_WEIGHT (selectNext, seenBefore). Правила остановки — как v4: классификационная остановка уже
 * доминирует (SE ≤ 0,4 за 10 заданий не достигается, замер eval/test/run.ts --se-stop none — без изменений).
 * v6 (11.10): индекс честности (integrity.ts) — ловушки для нейросети на 2 числовых заданиях, лимит времени
 * фиксируется при показе; при high и подтверждённом грейде — needs_confirmation и подтверждающий тест (confirm.ts).
 * Правила остановки основной фазы — как v5.
 * v7 (11.10): общие компетенции в пуле подкатегории (ADR 0003, дополнение 11.10) — пул = свои семейства + общие по
 * generators/common-map.ts, доля общих ≤ MAX_COMMON_SHARE, в дозадавании общих нет. Правила остановки — как v6.
 */
export const POLICY_VERSION = 'adr-0002-v7';

/** Правила остановки основной фазы по версии политики; неизвестная версия (v1–v3) — как v4 (7–10, SE ≤ 0,4). */
export const RULES_BY_VERSION: Readonly<Record<string, StopLimits>> = {
  'adr-0002-v4': { min: MIN_ITEMS, max: MAX_ITEMS },
  'adr-0002-v5': { min: MIN_ITEMS, max: MAX_ITEMS },
  'adr-0002-v6': { min: MIN_ITEMS, max: MAX_ITEMS },
  'adr-0002-v7': { min: MIN_ITEMS, max: MAX_ITEMS },
};

export function rulesFor(version: string): StopLimits {
  return RULES_BY_VERSION[version] ?? RULES_BY_VERSION['adr-0002-v4']!;
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
/**
 * Дозадавание Middle у заявки Senior — до 4 заданий (весь Middle-пул подкатегории, MIN_FAMILIES_BY_GRADE.middle).
 * Основная фаза Senior — только 4 Senior-задания; после них у профиля «Senior неверно, Middle верно» трёх Middle-заданий
 * не хватало: P(Middle) 0,78…0,79 < CONFIRM_PROB, и «Middle в 1 клик» не предлагался (tests/unit/test/senior-policy).
 */
export const MIDDLE_PROBE_MAX = 4;
const PROBE_MAX: Record<'junior' | 'middle', number> = { junior: JUNIOR_PROBE_MAX, middle: MIDDLE_PROBE_MAX };
/** Общий потолок заданий попытки: основная фаза + дозадавание (Senior: 4 + 4 — меньше). */
export const MAX_ITEMS_TOTAL = MAX_ITEMS + JUNIOR_PROBE_MAX;

/** Фаза попытки: основная (по порогу заявленного грейда), дозадавание Junior или (заявка Senior) — Middle. */
export type AttemptPhase = 'main' | 'junior_probe' | 'middle_probe';

/**
 * Стартовая θ для выбора первого задания. Заявка Senior идёт по Senior-пулу (ADR 0003, 16:15; см. mainPool): при θ = 1,2 информация Фишера выше у заданий с b 1,0…1,7. Junior и Middle — с 0, как до Senior.
 */
export const START_THETA: Record<Grade, number> = { junior: 0, middle: 0, senior: 1.2 };

/** Грейд дозадавания для заявленного: Senior → Middle, Middle и Junior → Junior. */
export function probeGrade(grade: Grade): 'junior' | 'middle' {
  return grade === 'senior' ? 'middle' : 'junior';
}

const PHASE_OF: Record<'junior' | 'middle', AttemptPhase> = { junior: 'junior_probe', middle: 'middle_probe' };

export interface StepInput {
  /** Все шаблоны специализации. */
  pool: readonly SelectableTemplate[];
  /** Показанные и отвеченные шаблоны попытки, по порядку (shown[i] ↔ responses[i]). */
  shown: readonly SelectableTemplate[];
  responses: readonly Response[];
  grade: Grade;
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
export function needsJuniorProbe(est: ThetaEstimate, grade: Grade, juniorLeft: number): boolean {
  return needsProbe(est, grade, juniorLeft);
}

/**
 * Общее правило дозадавания: заявленный грейд не подтверждён, P(грейд дозадавания) неуверенная (0,2…0,8)
 * и есть непоказанные шаблоны этого грейда.
 *
 * Заявка Senior — дозадавание Middle, когда Senior не подтверждён, а Middle уверенно не отвергнут (P(Middle) > 0,2;
 * верхней границы нет). Основная фаза Senior — всего 4 Senior-задания, их мало и для решения о Senior (при 4 из 4
 * верных P(Senior) у персоны Senior — 0,52), и для «Middle в 1 клик». Middle-задания уточняют θ в обе стороны:
 * у Senior добирают P(Senior) до CONFIRM_PROB, у Middle — P(Middle), а ложный Senior сдерживают неверные Senior-ответы.
 */
export function needsProbe(est: ThetaEstimate, grade: Grade, left: number): boolean {
  if (left <= 0) return false;
  const pg = probeGrade(grade);
  if (grade === 'senior') return probAbove(est, GRADE_CUT.senior) < CONFIRM_PROB && probAbove(est, GRADE_CUT.middle) > 1 - CONFIRM_PROB;
  if (grade !== pg && probAbove(est, GRADE_CUT[grade]) >= CONFIRM_PROB) return false;
  return juniorUncertain(probAbove(est, GRADE_CUT[pg]));
}

/**
 * Пул основной фазы для заявленного грейда (ADR 0003, дополнение 16:15; данные лейнов генераторов 10.10).
 * Заявка Senior — только Senior-шаблоны: без этого Middle набирал высокий θ на десятке Junior/Middle-заданий и
 * подтверждал Senior в 18–47 % (симуляции gen-frontend, gen-backend, engineering), не дойдя до Senior-заданий.
 * Основная фаза Senior кончается по CONFIRM_PROB/SE или по исчерпанию Senior-пула (4 семейства подкатегории),
 * затем при неуверенности — дозадавание Middle. Junior и Middle — весь пул подкатегории, как до Senior.
 * Если Senior-шаблонов в пуле нет (переходный пул направления) — весь пул.
 */
export function mainPool<T extends SelectableTemplate>(pool: readonly T[], grade?: Grade): readonly T[] {
  if (grade !== 'senior') return pool;
  const senior = pool.filter((t) => t.grade === 'senior');
  return senior.length > 0 ? senior : pool;
}

/**
 * Пул для выбора следующего задания в фазе: в дозадавании — только шаблоны грейда дозадавания; в основной фазе —
 * mainPool заявленного грейда. `grade` не передан — основная фаза без ограничения (как до Senior).
 */
export function phasePool<T extends SelectableTemplate>(pool: readonly T[], phase: AttemptPhase, grade?: Grade): readonly T[] {
  // Дозадавание уточняет грейд ниже по своей подкатегории — общих семейств в нём нет (ADR 0003, дополнение 11.10).
  if (phase === 'junior_probe') return pool.filter((t) => t.grade === 'junior' && !t.common);
  if (phase === 'middle_probe') return pool.filter((t) => t.grade === 'middle' && !t.common);
  return mainPool(pool, grade);
}

/**
 * Решение после очередного ответа: остановить попытку или дать следующее задание и в какой фазе.
 * Чистая функция от ответов (фаза не хранится в БД, а выводится повтором shouldStop по префиксам):
 * те же ответы → та же фаза и та же остановка.
 *
 * 1. Основная фаза — shouldStop по порогу заявленного грейда (MIN_ITEMS…MAX_ITEMS или исчерпание mainPool:
 *    у заявки Senior это Senior-пул подкатегории).
 * 2. Остановилась, и needsJuniorProbe (заявка Middle или Junior) → фаза junior_probe: до JUNIOR_PROBE_MAX Junior-заданий
 *    (randomesque и лимит доли утверждения — как в основной), стоп, как только
 *    P(Junior) ≥ EARLY_STOP_PROB или ≤ 1 − EARLY_STOP_PROB, исчерпан лимит или Junior-шаблоны.
 * 3. Заявка Senior: основная фаза — Senior-пул, дозадавание — middle_probe до MIDDLE_PROBE_MAX Middle-заданий
 *    по тем же правилам с порогом Middle.
 * Решение о грейде (decide) берёт все ответы попытки: адаптивный выбор заданий не смещает
 * апостериорную оценку θ, дозаданные ответы — такие же наблюдения.
 */
export function nextStep(input: StepInput, limits: StopLimits = { min: MIN_ITEMS, max: MAX_ITEMS }): Step {
  const { pool, shown, responses, grade, probe: probeAllowed = true } = input;
  const n = responses.length;
  const pg = probeGrade(grade);
  const phase = PHASE_OF[pg];
  // Дозадавание — только свои семейства (phasePool); общие того же грейда из основной фазы их не расходуют.
  const juniorTotal = pool.filter((t) => t.grade === pg && !t.common).length;
  const juniorShown = (k: number) => shown.slice(0, k).filter((t) => t.grade === pg && !t.common).length;
  // Исчерпание основной фазы — по достижимому числу заданий: общие сверх MAX_COMMON_SHARE не выдать.
  const mainSize = reachableSize(mainPool(pool, grade));
  // Потолок основной фазы для прогресса: у заявки Senior — размер Senior-пула (4), а не MAX_ITEMS.
  const mainMax = Math.min(limits.max, mainSize);

  // Где остановилась основная фаза (повтор по префиксам ответов).
  let mainLength: number | null = null;
  let mainStop: StopDecision = { stop: false, reason: null };
  for (let k = 1; k <= n; k++) {
    const d = shouldStop(k, estimateTheta(responses.slice(0, k)), grade, k >= mainSize, limits);
    if (d.stop) {
      mainLength = k;
      mainStop = d;
      break;
    }
  }
  if (mainLength === null) return { stop: false, reason: null, phase: 'main', mainLength: null, maxItems: mainMax };

  const atMain = estimateTheta(responses.slice(0, mainLength));
  const juniorLeft = juniorTotal - juniorShown(mainLength);
  if (!probeAllowed || !needsProbe(atMain, grade, juniorLeft)) {
    return { ...mainStop, stop: true, phase: 'main', mainLength, maxItems: mainMax };
  }

  // Потолок фазы — сколько реально можно дозадать: не больше оставшихся Junior-шаблонов (на backend
  // их часто 2), иначе экран обещал бы 13 заданий, а тест кончался на 12.
  const probeMax = mainLength + Math.min(PROBE_MAX[pg], juniorLeft);
  const probeAnswered = n - mainLength;
  const probe = (stop: boolean, reason: StopReason | null): Step => ({ stop, reason, phase, mainLength, maxItems: probeMax });
  if (probeAnswered > 0 && grade === 'senior') {
    // Senior: стоп, как только Senior подтверждён или Middle уверенно отвергнут; иначе — весь Middle-лимит.
    const est = estimateTheta(responses);
    if (probAbove(est, GRADE_CUT.senior) >= CONFIRM_PROB) return probe(true, 'confident');
    if (probAbove(est, GRADE_CUT.middle) <= 1 - EARLY_STOP_PROB) return probe(true, 'middle_resolved');
  } else if (probeAnswered > 0) {
    const pProbe = probAbove(estimateTheta(responses), GRADE_CUT[pg]);
    if (pProbe >= EARLY_STOP_PROB || pProbe <= 1 - EARLY_STOP_PROB) return probe(true, pg === 'junior' ? 'junior_resolved' : 'middle_resolved');
  }
  if (probeAnswered >= PROBE_MAX[pg] || juniorShown(n) >= juniorTotal) return probe(true, 'max_items');
  return probe(false, null);
}

export interface GradeDecision {
  theta: number;
  se: number;
  pPass: number;
  pJunior: number;
  confirmed: boolean;
  /**
   * Заявленный грейд не подтверждён, но грейд ниже подтверждается по той же попытке: Middle → Junior,
   * Senior → Middle (имя поля — историческое, как в БД).
   */
  juniorOffered: boolean;
  /** Какой грейд предлагается при juniorOffered (Junior или Middle); null — предложения нет. */
  offeredGrade: Grade | null;
  /** P(θ > порог грейда ниже заявленного); у заявки Junior — null. */
  pLower: number | null;
}

/** Решение о грейде по ответам (чистое: те же ответы → то же решение). */
export function decide(responses: readonly Response[], grade: Grade, confirmProb: number = CONFIRM_PROB): GradeDecision {
  const est = estimateTheta(responses);
  const pPass = probAbove(est, GRADE_CUT[grade]);
  const pJunior = probAbove(est, GRADE_CUT.junior);
  const confirmed = responses.length > 0 && pPass >= confirmProb;
  const lower = lowerGrade(grade);
  const pLower = lower ? probAbove(est, GRADE_CUT[lower]) : null;
  const offered = lower !== null && !confirmed && responses.length > 0 && pLower! >= confirmProb;
  return {
    theta: est.theta,
    se: est.se,
    pPass,
    pJunior,
    confirmed,
    juniorOffered: offered,
    offeredGrade: offered ? lower : null,
    pLower,
  };
}

export function specLabel(s: Specialization): string {
  return SPEC_LABEL[s];
}

export function gradeLabel(g: Grade): string {
  return GRADE_LABEL[g];
}

/** Объяснение итога кандидату: без θ-жаргона, с вероятностью и числом решённых. */
export function explainDecision(d: GradeDecision, grade: Grade, answered: number, correct: number): string {
  const pct = Math.round(d.pPass * 100);
  const base = `Решено ${correct} из ${answered}. Уверенность, что уровень не ниже ${gradeLabel(grade)}: ${pct}% (нужно не меньше ${Math.round(CONFIRM_PROB * 100)}%).`;
  if (d.confirmed) return `${base} Грейд ${gradeLabel(grade)} подтверждён.`;
  if (d.juniorOffered && d.offeredGrade) {
    const lower = gradeLabel(d.offeredGrade);
    return `${base} ${gradeLabel(grade)} не подтверждён, но задания уровня ${lower} решены уверенно (${Math.round((d.pLower ?? d.pJunior) * 100)}%): можно подтвердить ${lower} по этой же попытке.`;
  }
  return `${base} Грейд ${gradeLabel(grade)} не подтверждён. Уже подтверждённая категория не снимается.`;
}
