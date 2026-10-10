// Персоны-тестировщики через боевой движок теста на грейд (ADR-0002, дополнение 10.10), без LLM и без БД.
// Персона — легенда и заранее заданная модель знаний: по каждому из 12 шаблонов специализации
// «решит» (1), «монета» (0,5) или «не решит» (0). Цикл тот же, что в service.ts и eval/test/run.ts:
// policy.selectNext по пулу фазы / nextStep (основная фаза + дозадавание Junior) / decide, параметры a, b
// из кода (экспертные).
//
// Запуск из platform/:
//   npm run eval:test-personas                                  # текущий GRADE_CUT, N = 2000 на персону и грейд
//   npx tsx eval/test/personas.ts --n 4000 --seed 1 --no-probe   # без дозадавания (как до adr-0002-v2/v3)
//   npx tsx eval/test/personas.ts --n 2000 --junior-cut -1.0    # другой порог Junior
//   npx tsx eval/test/personas.ts --sweep -1.5:-0.6:0.1         # свип порога Junior
//   npx tsx eval/test/personas.ts --spec engineering            # только персоны одного направления
//   npx tsx eval/test/personas.ts --sub engineering.devops      # только персоны одной подкатегории
//
// Честная граница: это симуляция моделей знаний персон агентом, не живые люди. Матрицы знаний —
// наша гипотеза (легенды: fsp/docs/research/22-persona-calibration.md владельца), a и b — экспертные.
// В отличие от run.ts, вероятность ответа зависит не от θ, а от профиля знаний: так видно, что
// порог пропускает «узкий» профиль, которого синтетика по θ не видит.
import { generatorsFor } from '../../src/server/test/generators';
import { estimateTheta, type Response } from '../../src/server/test/irt';
import { decide, GRADE_CUT, nextStep, phasePool, SE_STOP, selectNext, shouldStop, type AttemptPhase, type SelectableTemplate } from '../../src/server/test/policy';
import { createRng, deriveSeed } from '../../src/server/test/rng';
import type { Grade, Specialization } from '../../src/server/types';

const args = process.argv.slice(2);
const argStr = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const N = Number(argStr('n') ?? 2000);
const SEED = Number(argStr('seed') ?? 1);
const BASE_JUNIOR_CUT = GRADE_CUT.junior;
// Порог Senior в движке ещё не задан (политика Senior — у лейна directions). Локально 0,6 — ДО ПОЛИТИКИ
// (ADR-0003, дополнение 10.10 16:15): только для прогона персон, в прод-код не попадает.
const SENIOR_CUT_LOCAL = 0.6;
(GRADE_CUT as Record<string, number>).senior ??= SENIOR_CUT_LOCAL;
/** --no-probe: только основная фаза (shouldStop), как до дозадавания Junior — для сравнения «до/после». */
const PROBE = !args.includes('--no-probe');
/** --spec <направление>: прогнать только персоны этого направления (seed персон от этого не меняются). */
const SPEC = argStr('spec') as Specialization | undefined;
/** --sub <подкатегория>: только персоны этой подкатегории (например engineering.devops). */
const SUB = argStr('sub');

/** Истинный уровень по легенде: ниже Junior, Junior, Middle, Senior. */
type Truth = 'below' | 'junior' | 'middle' | 'senior';

interface Persona {
  id: string;
  spec: Specialization;
  /** Подкатегория: пул попытки — только её семейства (тест на подкатегорию). Без неё — всё направление. */
  sub?: string;
  truth: Truth;
  legend: string;
  /** P(верно) по шаблону: 1 — решит, 0,5 — монета, 0 — не решит (типичная ошибка). */
  knows: Record<string, number>;
}

const Y = 1;
const H = 0.5;
const X = 0;
const BE = ['http-semantics', 'sql-rowcount', 'n-plus-one', 'find-bug-idor', 'shell-output', 'schema-constraint', 'retry-policy', 'delivery-semantics', 'payment-retry', 'cache-consistency', 'index-choice', 'isolation-anomaly'].map((s) => `be.${s}`);
// Engineering — тест на подкатегорию (ADR-0003, дополнение 10.10 16:15): по 14 семейств —
// 6 Junior, 4 Middle, 4 Senior, внутри грейда по возрастанию b.
const ENG_SUB: Record<string, string[]> = {
  'engineering.data-eng': ['group-having', 'dedup-count', 'null-aggregates', 'csv-fields', 'join-fanout', 'schema-types', 'idempotent-load', 'scd2-as-of', 'partition-prune', 'incremental-watermark', 'backfill-nights', 'diag-data', 'late-window', 'consumer-duplicates'],
  'engineering.devops': ['secrets-leak', 'port-mapping', 'docker-cache', 'cron-runs', 'env-precedence', 'ci-stages', 'k8s-capacity', 'k8s-probes', 'rolling-update', 'deploy-rollback', 'hpa-replicas', 'zone-capacity', 'diag-deploy', 'rollout-blast'],
  'engineering.qa-automation': ['test-pyramid', 'boundary-values', 'locator-stability', 'fixture-isolation', 'rerun-report', 'parametrize-count', 'contract-test', 'mock-calls', 'flaky-line', 'branch-coverage', 'ci-sharding', 'retry-budget', 'diag-tests', 'mutation-survivors'],
  'engineering.sre': ['log-count', 'symptom-alert', 'escalation', 'error-budget', 'latency-percentile', 'counter-reset', 'retry-amplification', 'littles-law', 'burn-rate', 'circuit-breaker', 'dependency-budget', 'diag-latency', 'redundancy-nodes', 'mm1-latency'],
};
const eng = (sub: string, row: number[]) => matrix(ENG_SUB[`engineering.${sub}`]!.map((s) => `eng.${s}`), row);
const FE = ['js-array-output', 'html-semantics', 'css-specificity', 'js-closure', 'css-flex', 'dom-events', 'complexity', 'state-bug', 'event-loop', 'ts-typecheck', 'api-client-race', 'web-vitals'].map((s) => `fe.${s}`);
const matrix = (ids: string[], row: number[]): Record<string, number> => Object.fromEntries(ids.map((id, i) => [id, row[i]!]));

// Порядок колонок — BE / FE выше (по возрастанию b внутри грейда).
const PERSONAS: Persona[] = [
  { id: 'B1', spec: 'backend', truth: 'below', legend: 'не из ИТ, логист', knows: matrix(BE, [H, X, X, X, X, X, H, X, X, H, X, X]) },
  { id: 'B2', spec: 'backend', truth: 'below', legend: 'курсы Python 3 мес.', knows: matrix(BE, [Y, H, H, X, H, H, H, X, X, H, X, X]) },
  { id: 'B3', spec: 'backend', truth: 'junior', legend: 'уверенный Junior, 1,5 года Django', knows: matrix(BE, [Y, Y, Y, Y, H, Y, H, X, H, H, X, X]) },
  { id: 'B4', spec: 'backend', truth: 'junior', legend: 'слабый узкий Junior, платежи', knows: matrix(BE, [Y, H, Y, H, X, H, Y, Y, Y, H, X, X]) },
  { id: 'B5', spec: 'backend', truth: 'middle', legend: 'Middle, 4 года Java', knows: matrix(BE, [Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, H, H]) },
  { id: 'F1', spec: 'frontend', truth: 'junior', legend: 'пограничный J/M, 2 года React', knows: matrix(FE, [Y, Y, Y, Y, H, H, Y, Y, H, X, H, X]) },
  { id: 'F2', spec: 'frontend', truth: 'middle', legend: 'Middle с перекосом в вёрстку', knows: matrix(FE, [Y, Y, Y, H, Y, Y, H, Y, X, X, H, H]) },
  { id: 'F3', spec: 'frontend', truth: 'below', legend: 'верстальщик без JS, курсы 3 мес.', knows: matrix(FE, [H, Y, Y, X, Y, X, X, X, X, X, H, X]) },
  { id: 'Z0', spec: 'backend', truth: 'below', legend: 'контроль: не решает ничего', knows: matrix(BE, BE.map(() => X)) },
  // Идеальные контроли (10.10, ADR-0002 «Дозадавание Junior-заданий»): все Junior-задания верно, все Middle — неверно.
  // Не легенды, в суммы ошибок не входят. Стоят после Z0, чтобы seed прежних персон не сдвинулись.
  { id: 'JB', spec: 'backend', truth: 'junior', legend: 'контроль: все Junior верно, Middle неверно', knows: matrix(BE, [Y, Y, Y, Y, Y, Y, X, X, X, X, X, X]) },
  { id: 'JF', spec: 'frontend', truth: 'junior', legend: 'контроль: все Junior верно, Middle неверно', knows: matrix(FE, [Y, Y, Y, Y, Y, Y, X, X, X, X, X, X]) },
  // Engineering (тест на подкатегорию, ADR-0003, дополнение 10.10 16:15): на каждую подкатегорию 8 типов
  // из ADR — новичок (N), пограничный новичок (NB), Junior (J), Junior с одной слабой темой (JW), Middle (M),
  // Middle с одной слабой темой (MW), Senior (S), идеальный Junior (I, контроль), пограничный Junior (JB, без цели). Пул попытки — 14 семейств
  // подкатегории (поле sub). Колонки — ENG_SUB: 6 Junior | 4 Middle | 4 Senior. Легенды — гипотеза агента
  // по research/25 § 3.4, не люди. «Слабая тема» — одно семейство своего грейда целиком не решено.
  { id: 'DN', spec: 'engineering', sub: 'engineering.data-eng', truth: 'below', legend: 'Excel-аналитик, курсы SQL 3 мес.', knows: eng('data-eng', [Y, H, X, X, X, X, X, X, X, X, X, X, X, X]) },
  { id: 'DNB', spec: 'engineering', sub: 'engineering.data-eng', truth: 'below', legend: 'аналитик, 6 мес. SQL-отчётов', knows: eng('data-eng', [Y, Y, H, H, X, X, H, X, X, X, X, X, X, X]) },
  { id: 'DJ', spec: 'engineering', sub: 'engineering.data-eng', truth: 'junior', legend: 'Junior data-инженер, 1 год ETL на SQL', knows: eng('data-eng', [Y, Y, Y, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'DJB', spec: 'engineering', sub: 'engineering.data-eng', truth: 'junior', legend: 'пограничный Junior (4 из 6 Junior), без цели', knows: eng('data-eng', [Y, Y, X, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'DJW', spec: 'engineering', sub: 'engineering.data-eng', truth: 'junior', legend: 'Junior с одной слабой темой: одно Junior-семейство из 6 не решает', knows: eng('data-eng', [Y, Y, X, Y, Y, Y, H, X, X, X, X, X, X, X]) },
  { id: 'DM', spec: 'engineering', sub: 'engineering.data-eng', truth: 'middle', legend: 'Middle data-инженер, 4 года, Spark и DWH', knows: eng('data-eng', [Y, Y, Y, Y, Y, Y, Y, Y, Y, H, H, X, X, X]) },
  { id: 'DMW', spec: 'engineering', sub: 'engineering.data-eng', truth: 'middle', legend: 'Middle data-инженер без SCD2 в практике', knows: eng('data-eng', [Y, Y, Y, Y, Y, Y, Y, X, Y, Y, H, X, X, X]) },
  { id: 'DS', spec: 'engineering', sub: 'engineering.data-eng', truth: 'senior', legend: 'Senior data-инженер, 7 лет, платформа данных', knows: eng('data-eng', [Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, H]) },
  { id: 'DI', spec: 'engineering', sub: 'engineering.data-eng', truth: 'junior', legend: 'контроль: все Junior верно, Middle и Senior неверно', knows: eng('data-eng', [Y, Y, Y, Y, Y, Y, X, X, X, X, X, X, X, X]) },
  { id: 'ON', spec: 'engineering', sub: 'engineering.devops', truth: 'below', legend: 'сисадмин, курсы DevOps 3 мес.', knows: eng('devops', [Y, H, X, X, X, X, X, X, X, X, X, X, X, X]) },
  { id: 'ONB', spec: 'engineering', sub: 'engineering.devops', truth: 'below', legend: 'сисадмин, полгода с Docker', knows: eng('devops', [Y, Y, H, H, X, X, H, X, X, X, X, X, X, X]) },
  { id: 'OJ', spec: 'engineering', sub: 'engineering.devops', truth: 'junior', legend: 'Junior DevOps, 1 год CI/CD и Docker', knows: eng('devops', [Y, Y, Y, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'OJB', spec: 'engineering', sub: 'engineering.devops', truth: 'junior', legend: 'пограничный Junior (4 из 6 Junior), без цели', knows: eng('devops', [Y, Y, X, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'OJW', spec: 'engineering', sub: 'engineering.devops', truth: 'junior', legend: 'Junior с одной слабой темой: одно Junior-семейство из 6 не решает', knows: eng('devops', [Y, Y, X, Y, Y, Y, H, X, X, X, X, X, X, X]) },
  { id: 'OM', spec: 'engineering', sub: 'engineering.devops', truth: 'middle', legend: 'Middle DevOps, 4 года Kubernetes', knows: eng('devops', [Y, Y, Y, Y, Y, Y, Y, Y, Y, H, H, X, X, X]) },
  { id: 'OMW', spec: 'engineering', sub: 'engineering.devops', truth: 'middle', legend: 'Middle DevOps без проб в практике', knows: eng('devops', [Y, Y, Y, Y, Y, Y, Y, X, Y, Y, H, X, X, X]) },
  { id: 'OS', spec: 'engineering', sub: 'engineering.devops', truth: 'senior', legend: 'Senior DevOps/platform, 7 лет', knows: eng('devops', [Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, H]) },
  { id: 'OI', spec: 'engineering', sub: 'engineering.devops', truth: 'junior', legend: 'контроль: все Junior верно, Middle и Senior неверно', knows: eng('devops', [Y, Y, Y, Y, Y, Y, X, X, X, X, X, X, X, X]) },
  { id: 'QN', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'below', legend: 'ручной тестировщик, курсы автотестов 2 мес.', knows: eng('qa-automation', [Y, H, X, X, X, X, X, X, X, X, X, X, X, X]) },
  { id: 'QNB', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'below', legend: 'ручной тестировщик, полгода пишет автотесты', knows: eng('qa-automation', [Y, Y, H, H, X, X, H, X, X, X, X, X, X, X]) },
  { id: 'QJ', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'junior', legend: 'Junior автоматизатор, 1 год pytest', knows: eng('qa-automation', [Y, Y, Y, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'QJB', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'junior', legend: 'пограничный Junior (4 из 6 Junior), без цели', knows: eng('qa-automation', [Y, Y, X, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'QJW', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'junior', legend: 'Junior с одной слабой темой: одно Junior-семейство из 6 не решает', knows: eng('qa-automation', [Y, Y, X, Y, Y, Y, H, X, X, X, X, X, X, X]) },
  { id: 'QM', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'middle', legend: 'Middle SDET, 4 года', knows: eng('qa-automation', [Y, Y, Y, Y, Y, Y, Y, Y, Y, H, H, X, X, X]) },
  { id: 'QMW', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'middle', legend: 'Middle SDET без моков в практике', knows: eng('qa-automation', [Y, Y, Y, Y, Y, Y, Y, X, Y, Y, H, X, X, X]) },
  { id: 'QS', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'senior', legend: 'Senior SDET / лид автоматизации, 7 лет', knows: eng('qa-automation', [Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, H]) },
  { id: 'QI', spec: 'engineering', sub: 'engineering.qa-automation', truth: 'junior', legend: 'контроль: все Junior верно, Middle и Senior неверно', knows: eng('qa-automation', [Y, Y, Y, Y, Y, Y, X, X, X, X, X, X, X, X]) },
  { id: 'SN', spec: 'engineering', sub: 'engineering.sre', truth: 'below', legend: 'инженер поддержки 1-й линии, без кода', knows: eng('sre', [Y, H, X, X, X, X, X, X, X, X, X, X, X, X]) },
  { id: 'SNB', spec: 'engineering', sub: 'engineering.sre', truth: 'below', legend: 'инженер поддержки 2-й линии, полгода дежурств', knows: eng('sre', [Y, Y, H, H, X, X, H, X, X, X, X, X, X, X]) },
  { id: 'SJ', spec: 'engineering', sub: 'engineering.sre', truth: 'junior', legend: 'Junior SRE, 1 год мониторинга и дежурств', knows: eng('sre', [Y, Y, Y, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'SJB', spec: 'engineering', sub: 'engineering.sre', truth: 'junior', legend: 'пограничный Junior (4 из 6 Junior), без цели', knows: eng('sre', [Y, Y, X, Y, Y, H, H, X, X, X, X, X, X, X]) },
  { id: 'SJW', spec: 'engineering', sub: 'engineering.sre', truth: 'junior', legend: 'Junior с одной слабой темой: одно Junior-семейство из 6 не решает', knows: eng('sre', [Y, Y, X, Y, Y, Y, H, X, X, X, X, X, X, X]) },
  { id: 'SM', spec: 'engineering', sub: 'engineering.sre', truth: 'middle', legend: 'Middle SRE, 4 года', knows: eng('sre', [Y, Y, Y, Y, Y, Y, Y, Y, Y, H, H, X, X, X]) },
  { id: 'SMW', spec: 'engineering', sub: 'engineering.sre', truth: 'middle', legend: 'Middle SRE без расчёта очередей', knows: eng('sre', [Y, Y, Y, Y, Y, Y, Y, X, Y, Y, H, X, X, X]) },
  { id: 'SS', spec: 'engineering', sub: 'engineering.sre', truth: 'senior', legend: 'Senior SRE, 7 лет, ёмкость и надёжность', knows: eng('sre', [Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, H]) },
  { id: 'SI', spec: 'engineering', sub: 'engineering.sre', truth: 'junior', legend: 'контроль: все Junior верно, Middle и Senior неверно', knows: eng('sre', [Y, Y, Y, Y, Y, Y, X, X, X, X, X, X, X, X]) },
];
/** Персоны прогона: все или одного направления (--spec). Индекс seed — по полному списку. */
const ACTIVE = PERSONAS.filter((p) => (!SPEC || p.spec === SPEC) && (!SUB || p.sub === SUB));
/** Контроли — не легенды: в суммы ошибок не входят. */
const CONTROLS = new Set(['Z0', 'JB', 'JF', 'DI', 'OI', 'QI', 'SI', 'DJB', 'OJB', 'QJB', 'SJB']); // *JB — пограничный Junior, без цели
/** Есть ли в пуле персоны Senior-шаблоны: тогда считается и заявка Senior. */
const hasSenior = (pool: readonly SelectableTemplate[]) => pool.some((t) => t.grade === 'senior');

interface Outcome {
  confirmed: boolean;
  juniorOffered: boolean;
  length: number;
  theta: number;
  /** Была ли фаза дозадавания Junior. */
  probed: boolean;
  /** P(θ > порог Middle) ≥ CONFIRM_PROB по той же попытке. */
  middleConfirmed: boolean;
}

/** Одна попытка: тот же цикл, что в service.ts (без БД). */
function runAttempt(pool: readonly SelectableTemplate[], p: Persona, claimed: Grade, attemptSeed: number, answerSeed: number): Outcome {
  const rng = createRng(answerSeed);
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  let est = estimateTheta([]);
  let phase: AttemptPhase = 'main';
  let probed = false;
  for (let index = 0; index < pool.length; index++) {
    const next = selectNext(phasePool(pool, phase), { shown, theta: est.theta, seed: deriveSeed(attemptSeed, 1000 + index) });
    if (!next) break;
    shown.push(next);
    const known = p.knows[next.id];
    if (known === undefined) throw new Error(`Персона ${p.id}: нет клетки для шаблона ${next.id}`);
    responses.push({ a: next.a, b: next.b, correct: rng.next() < known });
    est = estimateTheta(responses);
    if (!PROBE) {
      if (shouldStop(responses.length, est, claimed, shown.length >= pool.length).stop) break;
      continue;
    }
    const step = nextStep({ pool, shown, responses, grade: claimed });
    if (step.phase === 'junior_probe') probed = true;
    if (step.stop) break;
    phase = step.phase;
  }
  const d = decide(responses, claimed);
  const middleConfirmed = decide(responses, 'middle').confirmed;
  return { confirmed: d.confirmed, juniorOffered: d.juniorOffered, length: responses.length, theta: d.theta, probed, middleConfirmed };
}

interface PersonaStats {
  p: Persona;
  /** Заявил Junior: Junior подтверждён. */
  pJunior: number;
  /** Заявил Middle: Middle подтверждён. */
  pMiddle: number;
  /** Заявил Middle, не подтверждён, предложен Junior в один клик. */
  pOffer: number;
  /** Заявил Senior: Senior подтверждён (NaN — в пуле нет Senior-шаблонов). */
  pSenior: number;
  /** Заявил Senior: подтверждён хотя бы Middle по той же попытке (P(θ > порог Middle) ≥ 0,8). */
  pSeniorMiddle: number;
  lenJunior: number;
  lenMiddle: number;
  thetaJunior: number;
  /** Доля попыток с фазой дозадавания: заявил Junior / заявил Middle. */
  probedJunior: number;
  probedMiddle: number;
}

/**
 * Прогон всех персон при пороге Junior = cut. GRADE_CUT — общий объект движка: на время прогона
 * значение подменяется и восстанавливается (так свип идёт через тот же код, что в проде).
 * Одни и те же seed попыток и ответов при любом cut — сравнение порогов честное.
 */
function runAll(cut: number): PersonaStats[] {
  GRADE_CUT.junior = cut;
  try {
    return ACTIVE.map((p) => {
      const pi = PERSONAS.indexOf(p);
      const pool: SelectableTemplate[] = generatorsFor(p.spec)
        .filter((g) => !p.sub || g.subcategoryId === p.sub)
        .map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
      let j = 0;
      let m = 0;
      let offer = 0;
      let lenJ = 0;
      let lenM = 0;
      let thJ = 0;
      let prJ = 0;
      let prM = 0;
      let sn = 0;
      let snM = 0;
      const senior = hasSenior(pool);
      for (let r = 0; r < N; r++) {
        const base = deriveSeed(SEED * 7919 + pi, r);
        const oj = runAttempt(pool, p, 'junior', deriveSeed(base, 1), deriveSeed(base, 2));
        const om = runAttempt(pool, p, 'middle', deriveSeed(base, 3), deriveSeed(base, 4));
        if (oj.confirmed) j++;
        if (om.confirmed) m++;
        if (om.juniorOffered) offer++;
        lenJ += oj.length;
        lenM += om.length;
        thJ += oj.theta;
        prJ += +oj.probed;
        prM += +om.probed;
        if (senior) {
          // Отдельные seed (5, 6): seed заявок Junior/Middle и их цифры не сдвигаются.
          const os = runAttempt(pool, p, 'senior', deriveSeed(base, 5), deriveSeed(base, 6));
          if (os.confirmed) sn++;
          if (os.middleConfirmed) snM++;
        }
      }
      return { p, pJunior: j / N, pMiddle: m / N, pOffer: offer / N, pSenior: senior ? sn / N : NaN, pSeniorMiddle: senior ? snM / N : NaN, lenJunior: lenJ / N, lenMiddle: lenM / N, thetaJunior: thJ / N, probedJunior: prJ / N, probedMiddle: prM / N };
    });
  } finally {
    GRADE_CUT.junior = BASE_JUNIOR_CUT;
  }
}

/**
 * Ошибки по легенде при данном пороге (для свипа):
 * ложное Junior — «ниже Junior» подтвердил Junior; ложный отказ Junior — Junior/Middle не подтвердил Junior
 * (контроли Z0, JB, JF в сумму не входят). Middle-тест от порога Junior не зависит, кроме предложения Junior.
 */
function errors(stats: PersonaStats[]) {
  const real = stats.filter((s) => !CONTROLS.has(s.p.id));
  const falsePass = real.filter((s) => s.p.truth === 'below').reduce((acc, s) => acc + s.pJunior, 0);
  const falseFail = real.filter((s) => s.p.truth !== 'below').reduce((acc, s) => acc + (1 - s.pJunior), 0);
  return { falsePass, falseFail, sum: falsePass + falseFail };
}

const f2 = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);
const t0 = Date.now();
const sweep = argStr('sweep');

if (sweep) {
  const [from, to, step] = sweep.split(':').map(Number) as [number, number, number];
  const cuts: number[] = [];
  for (let c = from; c <= to + 1e-9; c += step) cuts.push(Number(c.toFixed(4)));
  console.log(`# Свип порога Junior по персонам: N = ${N} попыток на персону и грейд, seed = ${SEED}, порог Middle = ${GRADE_CUT.middle}, ${PROBE ? 'с дозадаванием Junior' : 'без дозадавания'}\n`);
  const ids = ACTIVE.map((p) => p.id);
  console.log(`| Порог Junior | Зона Junior (Middle − Junior) | ${ids.map((id) => `${id} P(J)`).join(' | ')} | Σ ложных J | Σ отказов J | Σ ошибок |`);
  console.log(`|---|---|${ids.map(() => '---').join('|')}|---|---|---|`);
  for (const cut of cuts) {
    const s = runAll(cut);
    const e = errors(s);
    const width = GRADE_CUT.middle - cut;
    console.log(`| ${cut} | ${f2(width)}${width <= SE_STOP ? ' ⚠ ≤ SE' : ''} | ${s.map((x) => f2(x.pJunior)).join(' | ')} | ${f2(e.falsePass)} | ${f2(e.falseFail)} | ${f2(e.sum)} |`);
  }
} else {
  const cut = argStr('junior-cut') !== undefined ? Number(argStr('junior-cut')) : GRADE_CUT.junior;
  const s = runAll(cut);
  console.log(`# Персоны через движок теста: N = ${N} попыток на персону и грейд, seed = ${SEED}, пороги Junior ${cut} / Middle ${GRADE_CUT.middle} / Senior ${(GRADE_CUT as Record<string, number>).senior} (до политики), ${PROBE ? 'с дозадаванием Junior' : 'без дозадавания'}${SPEC ? `, направление ${SPEC}` : ''}${SUB ? `, подкатегория ${SUB}` : ''}\n`);
  console.log('| Персона | Легенда | Уровень по легенде | P(Junior), заявил Junior | Длина | Дозадавание | θ̂ | P(Middle), заявил Middle | Junior в 1 клик | Длина | Дозадавание | P(Senior), заявил Senior | Middle по Senior-попытке |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const fs = (x: number) => (Number.isNaN(x) ? '—' : f3(x));
  for (const x of s) {
    console.log(`| ${x.p.id} | ${x.p.legend} | ${x.p.truth} | ${f3(x.pJunior)} | ${x.lenJunior.toFixed(2)} | ${f2(x.probedJunior)} | ${f2(x.thetaJunior)} | ${f3(x.pMiddle)} | ${f3(x.pOffer)} | ${x.lenMiddle.toFixed(2)} | ${f2(x.probedMiddle)} | ${fs(x.pSenior)} | ${fs(x.pSeniorMiddle)} |`);
  }
  const e = errors(s);
  const real = ACTIVE.filter((p) => !CONTROLS.has(p.id));
  const below = real.filter((p) => p.truth === 'below').map((p) => p.id).join(', ');
  const above = real.filter((p) => p.truth !== 'below').map((p) => p.id).join(', ');
  console.log(`\nΣ ложных подтверждений Junior (${below}): ${f2(e.falsePass)}; Σ ложных отказов Junior (${above}): ${f2(e.falseFail)}`);
}
console.log(`\nВремя прогона: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
