// Персоны на подкатегорию через боевой движок теста (ADR 0003, дополнение 10.10 16:15; ADR-0002 «Senior и пул по
// подкатегориям»). Без LLM и без БД: тот же цикл, что в service.ts — пул poolFor(подкатегория), старт START_THETA,
// phasePool (заявка Senior — только Senior-пул, затем дозадавание Middle; дозадавание Junior), nextStep, decide.
//
// Персона — профиль знаний по семействам подкатегории, построенный по шаблону от уровня (не легенда человека):
// семейства каждого грейда упорядочены по b, «решит» (1), «монета» (0,5), «не решит» (0). Так один и тот же
// профиль прогоняется на каждой подкатегории, и видно, какая из них калибрована хуже.
//
//   новичок                J: ½ ½ 0 0 0 0 | M: 0 0 0 0 | S: 0 0 0 0
//   пограничный новичок    J: 1 1 ½ ½ 0 0 | M: ½ 0 0 0 | S: 0 0 0 0
//   Junior                 J: 1 1 1 1 1 ½ | M: ½ ½ 0 0 | S: 0 0 0 0
//   Junior, слабая тема    Junior, но одно Junior-семейство — 0 (перебираются все 6; в таблице — худшее и среднее)
//   Middle                 J: все 1       | M: 1 1 1 ½ | S: ½ 0 0 0
//   Middle, слабая тема    Middle, но одно Middle-семейство — 0 (перебираются все 4)
//   Senior                 J: все 1       | M: все 1   | S: 1 1 1 ½
//   идеальный Junior       J: все 1       | M: все 0   | S: все 0 (контроль)
//
// Цели (ADR 0003, 16:15): ложное подтверждение ≤ 10 % (новичок и пограничный — Junior; Junior — Middle;
// Middle — Senior), уверенный грейд ≥ 90 % (Junior — Junior, Middle — Middle, Senior — Senior),
// «с одной слабой темой» ≥ 85 %.
//
// Запуск из platform/:
//   npx tsx eval/test/subcategory-personas.ts                       # N = 1000 на персону и заявленный грейд
//   npx tsx eval/test/subcategory-personas.ts --n 400 --sub ai.mlops
//   npx tsx eval/test/subcategory-personas.ts --senior-cut 0.8      # другой порог Senior
//   npx tsx eval/test/subcategory-personas.ts --spec frontend --profiles frontend   # профили лейна gen-frontend
//
// --profiles frontend — набор профилей лейна gen-frontend (был в eval/test/personas-subcategory.ts, слит сюда при
// интеграции 10.10): N, NB, J, JS, M, MS, S, SS (Senior с одной слабой темой), JI. Отличается от набора ADR
// шаблонами строк (у JS слабая тема — самая трудная Junior-тема наполовину, а не перебор всех).
//
// Честная граница: симуляция профилей знаний, не живые люди; a и b — экспертные.
import { SUBCATEGORIES } from '../../src/lib/directions';
import { GRADES, type Grade } from '../../src/lib/grades';
import { poolFor } from '../../src/server/test/generators';
import { estimateTheta, type Response } from '../../src/server/test/irt';
import {
  CONFIRM_PROB,
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
  type StopLimits,
} from '../../src/server/test/policy';
import { createRng, deriveSeed } from '../../src/server/test/rng';

const args = process.argv.slice(2);
const argStr = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const N = Number(argStr('n') ?? 1000);
const SEED = Number(argStr('seed') ?? 1);
const SUB_ARG = argStr('sub');
const SPEC_ARG = argStr('spec') ?? 'ai';
if (argStr('senior-cut') !== undefined) GRADE_CUT.senior = Number(argStr('senior-cut'));
/** Эксперимент калибровки: --a-junior 1.3 / --b-junior-shift −0.2 — подменить a / сдвинуть b Junior-шаблонов (без правки кода). */
const A_JUNIOR = argStr('a-junior') !== undefined ? Number(argStr('a-junior')) : null;
const B_JUNIOR_SHIFT = Number(argStr('b-junior-shift') ?? 0);
const A_SENIOR = argStr('a-senior') !== undefined ? Number(argStr('a-senior')) : null;
const B_MIDDLE_SHIFT = Number(argStr('b-middle-shift') ?? 0);
/** Эксперимент: --set "n-plus-one=1.1,-1.2;pool-capacity=,-1" — подменить a и/или b семейства по хвосту id (пусто — не менять). */
const SET_ARG = new Map<string, [number | null, number | null]>(
  (argStr('set') ?? '')
    .split(';')
    .filter(Boolean)
    .map((e) => {
      const [k, v] = e.split('=');
      const [a, b] = (v ?? '').split(',');
      return [k!, [a ? Number(a) : null, b ? Number(b) : null]] as [string, [number | null, number | null]];
    }),
);
const A_MIDDLE = argStr('a-middle') !== undefined ? Number(argStr('a-middle')) : null;
/** Правила остановки: --rules <версия политики> (по умолчанию текущая), поверх — --min / --max / --early (эксперименты). */
const CONFIRM = argStr('confirm') !== undefined ? Number(argStr('confirm')) : CONFIRM_PROB;
const RULES_NAME = argStr('rules') ?? POLICY_VERSION;
const RULES: StopLimits = {
  ...rulesFor(RULES_NAME),
  ...(argStr('min') !== undefined ? { min: Number(argStr('min')) } : {}),
  ...(argStr('max') !== undefined ? { max: Number(argStr('max')) } : {}),
  ...(argStr('early') !== undefined ? { earlyStop: Number(argStr('early')) } : {}),
};

type Truth = 'below' | Grade;
interface Profile {
  id: string;
  name: string;
  truth: Truth;
  /** Строки J (6) | M (4) | S (4); weak — номер семейства грейда, которое персона не решает. */
  j: number[];
  m: number[];
  s: number[];
  weak?: { grade: Grade; count: number };
  control?: boolean;
  /** «С одной слабой темой» без перебора (набор gen-frontend): цель 0,85, а не 0,90. */
  slack?: boolean;
}

const Y = 1;
const H = 0.5;
const X = 0;
const PROFILES: Profile[] = [
  { id: 'N0', name: 'новичок', truth: 'below', j: [H, H, X, X, X, X], m: [X, X, X, X], s: [X, X, X, X] },
  { id: 'N1', name: 'пограничный новичок', truth: 'below', j: [Y, Y, H, H, X, X], m: [H, X, X, X], s: [X, X, X, X] },
  { id: 'J', name: 'Junior', truth: 'junior', j: [Y, Y, Y, Y, Y, H], m: [H, H, X, X], s: [X, X, X, X] },
  { id: 'Jw', name: 'Junior с одной слабой темой', truth: 'junior', j: [Y, Y, Y, Y, Y, Y], m: [H, H, X, X], s: [X, X, X, X], weak: { grade: 'junior', count: 6 } },
  { id: 'M', name: 'Middle', truth: 'middle', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, H], s: [H, X, X, X] },
  { id: 'Mw', name: 'Middle с одной слабой темой', truth: 'middle', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, Y], s: [H, X, X, X], weak: { grade: 'middle', count: 4 } },
  { id: 'S', name: 'Senior', truth: 'senior', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, Y], s: [Y, Y, Y, H] },
  { id: 'JI', name: 'идеальный Junior (контроль)', truth: 'junior', j: [Y, Y, Y, Y, Y, Y], m: [X, X, X, X], s: [X, X, X, X], control: true },
];

/** Набор лейна gen-frontend (личные профили; короче строки — добивается последним значением). */
const NONE = [X, X, X, X, X, X];
const FRONTEND_PROFILES: Profile[] = [
  { id: 'N', name: 'новичок: курсы 3 мес., знает самое лёгкое', truth: 'below', j: [H, H, X, X, X, X], m: NONE, s: NONE },
  { id: 'NB', name: 'пограничный новичок: стажёр 6 мес., два лёгких верно, третье наполовину', truth: 'below', j: [Y, Y, H, X, X, X], m: NONE, s: NONE },
  { id: 'J', name: 'уверенный Junior, 1,5 года опыта', truth: 'junior', j: [Y, Y, Y, Y, Y, Y], m: [H, X, X, X, X, X], s: NONE },
  { id: 'JS', name: 'Junior с одной слабой темой: пять Junior-тем верно, самая трудная наполовину', truth: 'junior', j: [Y, Y, Y, Y, Y, H], m: [H, X, X, X, X, X], s: NONE, slack: true },
  { id: 'M', name: 'Middle, 4 года опыта', truth: 'middle', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, Y, Y, Y], s: [H, X, X, X] },
  { id: 'MS', name: 'Middle с одной слабой темой: самая трудная пара Middle наполовину', truth: 'middle', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, Y, H, H], s: [H, X, X, X], slack: true },
  { id: 'S', name: 'Senior, 8 лет опыта', truth: 'senior', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, Y, Y, Y], s: [Y, Y, Y, Y] },
  { id: 'SS', name: 'Senior с одной слабой темой (сверх списка ADR): три Senior-темы верно, самая трудная наполовину', truth: 'senior', j: [Y, Y, Y, Y, Y, Y], m: [Y, Y, Y, Y, Y, Y], s: [Y, Y, Y, H], slack: true },
  { id: 'JI', name: 'контроль: все Junior верно, остальное неверно', truth: 'junior', j: [Y, Y, Y, Y, Y, Y], m: NONE, s: NONE, control: true },
];
/** Эксперимент: --j-mid "0.5,0,0,0" — строка Middle у Junior и «Junior со слабой темой» (по умолчанию ½ ½ 0 0). */
if (argStr('j-mid') !== undefined) {
  const row = argStr('j-mid')!.split(',').map(Number);
  for (const p of PROFILES) if (p.id === 'J' || p.id === 'Jw') p.m = row;
}
const ACTIVE_PROFILES = argStr('profiles') === 'frontend' ? FRONTEND_PROFILES : PROFILES;

interface Outcome {
  confirmed: boolean;
  offered: Grade | null;
  length: number;
  probed: boolean;
}

/** Профиль → P(верно) по id семейства: внутри грейда по возрастанию b. Лишние семейства (банк больше минимума) — как последнее в строке. */
function knowsFor(pool: readonly SelectableTemplate[], p: Profile, weakIndex: number | null): Map<string, number> {
  const out = new Map<string, number>();
  const rows: Record<Grade, number[]> = { junior: p.j, middle: p.m, senior: p.s };
  for (const g of GRADES) {
    const fam = pool.filter((t) => t.grade === g).sort((a, b) => a.b - b.b || a.id.localeCompare(b.id));
    fam.forEach((t, i) => {
      const row = rows[g];
      let v = row[Math.min(i, row.length - 1)]!;
      if (p.weak && p.weak.grade === g && weakIndex === i) v = X;
      out.set(t.id, v);
    });
  }
  return out;
}

function runAttempt(pool: readonly SelectableTemplate[], knows: Map<string, number>, claimed: Grade, attemptSeed: number, answerSeed: number): Outcome {
  const rng = createRng(answerSeed);
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  let phase: AttemptPhase = 'main';
  let probed = false;
  for (let index = 0; index < pool.length; index++) {
    const theta = responses.length ? estimateTheta(responses).theta : START_THETA[claimed];
    const next = selectNext(phasePool(pool, phase, claimed), { shown, theta, seed: deriveSeed(attemptSeed, 1000 + index) });
    if (!next) break;
    shown.push(next);
    responses.push({ a: next.a, b: next.b, correct: rng.next() < knows.get(next.id)! });
    const step = nextStep({ pool, shown, responses, grade: claimed }, RULES);
    if (step.phase !== 'main') probed = true;
    if (step.stop) break;
    phase = step.phase;
  }
  const d = decide(responses, claimed, CONFIRM);
  return { confirmed: d.confirmed, offered: d.juniorOffered ? d.offeredGrade : null, length: responses.length, probed };
}

interface Cell {
  confirm: number;
  offer: number;
  len: number;
  probed: number;
}

function runProfile(pool: readonly SelectableTemplate[], p: Profile, pi: number, weakIndex: number | null): Record<Grade, Cell> {
  const knows = knowsFor(pool, p, weakIndex);
  const out = {} as Record<Grade, Cell>;
  GRADES.forEach((g, gi) => {
    let confirm = 0;
    let offer = 0;
    let len = 0;
    let probed = 0;
    for (let r = 0; r < N; r++) {
      const base = deriveSeed(SEED * 7919 + pi * 31 + (weakIndex ?? 0), r);
      const o = runAttempt(pool, knows, g, deriveSeed(base, 1 + gi * 2), deriveSeed(base, 2 + gi * 2));
      confirm += +o.confirmed;
      offer += +(o.offered !== null);
      len += o.length;
      probed += +o.probed;
    }
    out[g] = { confirm: confirm / N, offer: offer / N, len: len / N, probed: probed / N };
  });
  return out;
}

const f2 = (x: number) => x.toFixed(2);
const t0 = Date.now();
const subs = SUBCATEGORIES.filter((s) => s.specialization === SPEC_ARG && (!SUB_ARG || s.id === SUB_ARG));
console.log(`# Персоны на подкатегорию: N = ${N} на персону и заявленный грейд, seed = ${SEED}, пороги J ${GRADE_CUT.junior} / M ${GRADE_CUT.middle} / S ${GRADE_CUT.senior}, правила ${RULES_NAME} (${RULES.min}–${RULES.max})\n`);

const verdicts: string[] = [];
for (const sub of subs) {
  const tp = poolFor(sub.specialization, sub.id);
  if (!tp || tp.legacy) {
    console.log(`## ${sub.id}: банка нет — пропуск\n`);
    continue;
  }
  const pool: SelectableTemplate[] = tp.generators.map((g) => {
    const a = g.grade === 'junior' && A_JUNIOR !== null ? A_JUNIOR : g.grade === 'senior' && A_SENIOR !== null ? A_SENIOR : g.grade === 'middle' && A_MIDDLE !== null ? A_MIDDLE : g.a;
    const b = g.grade === 'junior' ? g.b + B_JUNIOR_SHIFT : g.grade === 'middle' ? g.b + B_MIDDLE_SHIFT : g.b;
    const o = SET_ARG.get(g.id.split('.').pop()!);
    return { id: g.id, a: o?.[0] ?? a, b: o?.[1] ?? b, catalogIds: g.catalogIds, grade: g.grade };
  });

  console.log(`## ${sub.id} (${sub.title}): ${pool.length} семейств\n`);
  console.log('| Персона | Уровень | P(Junior) | P(Middle) | P(Senior) | Middle → Junior в 1 клик | Senior → Middle в 1 клик | Длина J / M / S | Дозадавание J / M / S |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  ACTIVE_PROFILES.forEach((p, pi) => {
    const runs = p.weak ? Array.from({ length: p.weak.count }, (_, w) => runProfile(pool, p, pi, w)) : [runProfile(pool, p, pi, null)];
    // Для «слабой темы» — худший вариант по своему грейду (и среднее в скобках).
    const own: Grade = p.truth === 'below' ? 'junior' : p.truth;
    const worst = runs.reduce((a, b) => (b[own].confirm < a[own].confirm ? b : a));
    const mean = (g: Grade, k: keyof Cell) => runs.reduce((s, x) => s + x[g][k], 0) / runs.length;
    const cell = (g: Grade) => (runs.length > 1 ? `${f2(worst[g].confirm)} (ср. ${f2(mean(g, 'confirm'))})` : f2(worst[g].confirm));
    console.log(
      `| ${p.id} ${p.name} | ${p.truth} | ${cell('junior')} | ${cell('middle')} | ${cell('senior')} | ${f2(worst.middle.offer)} | ${f2(worst.senior.offer)} | ${GRADES.map((g) => worst[g].len.toFixed(1)).join(' / ')} | ${GRADES.map((g) => f2(worst[g].probed)).join(' / ')} |`,
    );
    if (p.control) return;
    // Цели.
    const check = (ok: boolean, what: string) => {
      if (!ok) verdicts.push(`${sub.id} ${p.id}: ${what}`);
    };
    if (p.truth === 'below') check(worst.junior.confirm <= 0.1, `ложный Junior ${f2(worst.junior.confirm)} > 0.10`);
    if (p.truth === 'junior') {
      check(worst.middle.confirm <= 0.1, `ложный Middle ${f2(worst.middle.confirm)} > 0.10`);
      check(worst.junior.confirm >= (p.weak || p.slack ? 0.85 : 0.9), `Junior ${f2(worst.junior.confirm)} < ${p.weak || p.slack ? '0.85' : '0.90'}`);
    }
    if (p.truth === 'middle') {
      check(worst.senior.confirm <= 0.1, `ложный Senior ${f2(worst.senior.confirm)} > 0.10`);
      check(worst.middle.confirm >= (p.weak || p.slack ? 0.85 : 0.9), `Middle ${f2(worst.middle.confirm)} < ${p.weak || p.slack ? '0.85' : '0.90'}`);
    }
    if (p.truth === 'senior') check(worst.senior.confirm >= (p.slack ? 0.85 : 0.9), `Senior ${f2(worst.senior.confirm)} < ${p.slack ? '0.85' : '0.90'}`);
  });
  console.log('');
}
console.log(verdicts.length ? `Цели не выполнены:\n${verdicts.map((v) => `- ${v}`).join('\n')}` : 'Все цели выполнены (по худшему варианту «слабой темы»).');
console.log(`\nВремя прогона: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
