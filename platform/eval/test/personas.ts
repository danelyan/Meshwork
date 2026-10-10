// Персоны-тестировщики через боевой движок теста на грейд (ADR-0002, дополнение 10.10), без LLM и без БД.
// Персона — легенда и заранее заданная модель знаний: по каждому из 12 шаблонов специализации
// «решит» (1), «монета» (0,5) или «не решит» (0). Цикл тот же, что в service.ts и eval/test/run.ts:
// policy.selectNext / shouldStop / decide, параметры a, b из кода (экспертные).
//
// Запуск из platform/:
//   npm run eval:test-personas                                  # текущий GRADE_CUT, N = 2000 на персону и грейд
//   npx tsx eval/test/personas.ts --n 2000 --junior-cut -1.0    # другой порог Junior
//   npx tsx eval/test/personas.ts --sweep -1.5:-0.6:0.1         # свип порога Junior
//
// Честная граница: это симуляция моделей знаний персон агентом, не живые люди. Матрицы знаний —
// наша гипотеза (легенды: fsp/docs/research/22-persona-calibration.md владельца), a и b — экспертные.
// В отличие от run.ts, вероятность ответа зависит не от θ, а от профиля знаний: так видно, что
// порог пропускает «узкий» профиль, которого синтетика по θ не видит.
import { generatorsFor } from '../../src/server/test/generators';
import { estimateTheta, type Response } from '../../src/server/test/irt';
import { decide, GRADE_CUT, SE_STOP, selectNext, shouldStop, type SelectableTemplate } from '../../src/server/test/policy';
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

/** Истинный уровень по легенде: ниже Junior, Junior, Middle. */
type Truth = 'below' | 'junior' | 'middle';

interface Persona {
  id: string;
  spec: Specialization;
  truth: Truth;
  legend: string;
  /** P(верно) по шаблону: 1 — решит, 0,5 — монета, 0 — не решит (типичная ошибка). */
  knows: Record<string, number>;
}

const Y = 1;
const H = 0.5;
const X = 0;
const BE = ['http-semantics', 'sql-rowcount', 'n-plus-one', 'find-bug-idor', 'shell-output', 'schema-constraint', 'retry-policy', 'delivery-semantics', 'payment-retry', 'cache-consistency', 'index-choice', 'isolation-anomaly'].map((s) => `be.${s}`);
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
];

interface Outcome {
  confirmed: boolean;
  juniorOffered: boolean;
  length: number;
  theta: number;
}

/** Одна попытка: тот же цикл, что в service.ts (без БД). */
function runAttempt(pool: readonly SelectableTemplate[], p: Persona, claimed: Grade, attemptSeed: number, answerSeed: number): Outcome {
  const rng = createRng(answerSeed);
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  let est = estimateTheta([]);
  for (let index = 0; index < pool.length; index++) {
    const next = selectNext(pool, { shown, theta: est.theta, seed: deriveSeed(attemptSeed, 1000 + index) });
    if (!next) break;
    shown.push(next);
    const known = p.knows[next.id];
    if (known === undefined) throw new Error(`Персона ${p.id}: нет клетки для шаблона ${next.id}`);
    responses.push({ a: next.a, b: next.b, correct: rng.next() < known });
    est = estimateTheta(responses);
    if (shouldStop(responses.length, est, claimed, shown.length >= pool.length).stop) break;
  }
  const d = decide(responses, claimed);
  return { confirmed: d.confirmed, juniorOffered: d.juniorOffered, length: responses.length, theta: d.theta };
}

interface PersonaStats {
  p: Persona;
  /** Заявил Junior: Junior подтверждён. */
  pJunior: number;
  /** Заявил Middle: Middle подтверждён. */
  pMiddle: number;
  /** Заявил Middle, не подтверждён, предложен Junior в один клик. */
  pOffer: number;
  lenJunior: number;
  lenMiddle: number;
  thetaJunior: number;
}

/**
 * Прогон всех персон при пороге Junior = cut. GRADE_CUT — общий объект движка: на время прогона
 * значение подменяется и восстанавливается (так свип идёт через тот же код, что в проде).
 * Одни и те же seed попыток и ответов при любом cut — сравнение порогов честное.
 */
function runAll(cut: number): PersonaStats[] {
  GRADE_CUT.junior = cut;
  try {
    return PERSONAS.map((p, pi) => {
      const pool: SelectableTemplate[] = generatorsFor(p.spec).map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
      let j = 0;
      let m = 0;
      let offer = 0;
      let lenJ = 0;
      let lenM = 0;
      let thJ = 0;
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
      }
      return { p, pJunior: j / N, pMiddle: m / N, pOffer: offer / N, lenJunior: lenJ / N, lenMiddle: lenM / N, thetaJunior: thJ / N };
    });
  } finally {
    GRADE_CUT.junior = BASE_JUNIOR_CUT;
  }
}

/**
 * Ошибки по легенде при данном пороге (для свипа):
 * ложное Junior — «ниже Junior» подтвердил Junior; ложный отказ Junior — Junior/Middle не подтвердил Junior
 * (Z0 — контроль, в сумму не входит). Middle-тест от порога Junior не зависит, кроме предложения Junior.
 */
function errors(stats: PersonaStats[]) {
  const real = stats.filter((s) => s.p.id !== 'Z0');
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
  console.log(`# Свип порога Junior по персонам: N = ${N} попыток на персону и грейд, seed = ${SEED}, порог Middle = ${GRADE_CUT.middle}\n`);
  const ids = PERSONAS.map((p) => p.id);
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
  console.log(`# Персоны через движок теста: N = ${N} попыток на персону и грейд, seed = ${SEED}, пороги Junior ${cut} / Middle ${GRADE_CUT.middle}\n`);
  console.log('| Персона | Легенда | Уровень по легенде | P(Junior), заявил Junior | Длина | θ̂ | P(Middle), заявил Middle | Junior в 1 клик | Длина |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const x of s) {
    console.log(`| ${x.p.id} | ${x.p.legend} | ${x.p.truth} | ${f3(x.pJunior)} | ${x.lenJunior.toFixed(1)} | ${f2(x.thetaJunior)} | ${f3(x.pMiddle)} | ${f3(x.pOffer)} | ${x.lenMiddle.toFixed(1)} |`);
  }
  const e = errors(s);
  console.log(`\nΣ ложных подтверждений Junior (B1, B2, F3): ${f2(e.falsePass)}; Σ ложных отказов Junior (B3, B4, B5, F1, F2): ${f2(e.falseFail)}`);
}
console.log(`\nВремя прогона: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
