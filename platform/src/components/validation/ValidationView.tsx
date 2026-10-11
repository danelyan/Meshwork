import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Panel } from '@/components/ui';
import { PERSONA_NOTE, type PersonaRow, type SyntheticRow } from '@/server/validation/grade-test-figures';
import type { MatchingExtended, MatchingResults } from '@/server/validation/matching-results';
import type { BankWidth, LengthSweep } from '@/server/validation/length-sweep';
import { DEFAULT_ITEM_LIMITS, formatItemRange, type ItemLimits } from '@/lib/test-limits';

import { JuryBackLink } from '@/components/demo/JuryRoute';

import { dec, pct } from './format';
import styles from './Validation.module.css';

export interface GradeTestData {
  doc: string;
  policy: string;
  personas: PersonaRow[];
  synthetic: SyntheticRow[];
  targets: { falseConfirm: string; falseReject: string; retest: string; kappa: string; auc: string; length: string };
  commands: string[];
}

const METHOD_LABEL: Record<string, string> = { ours: 'Наш подбор', baselineClaims: 'Базовая линия (число утверждений)', bm25: 'BM25 по тексту', random: 'Случайный порядок' };
const METRIC_LABEL: Record<string, string> = { p5: 'P@5', p10: 'P@10', ndcg10: 'nDCG@10', recall50: 'Recall@50', mrr: 'MRR' };

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/** Таблица методов и разниц с интервалом из расширенного прогона; пустые блоки не рисуем. */
function AblationBlock({ ab }: { ab: NonNullable<MatchingResults['ablation']> }) {
  const full = ab.rows.find((r) => r.signal === 'full');
  const sign = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(3).replace('.', ',')}`;
  if (!full) return null;
  return (
    <>
      <h3>Абляция: что даёт каждый сигнал формулы</h3>
      <p className={styles.soft}>
        {ab.vacancies} вакансий × {ab.profiles} профилей. Сигнал выключаем по одному, остальная формула прежняя; Δ – разница с полной формулой
        (минус – сигнал помогает), в скобках 95 % интервал (парный бутстреп по вакансиям). Разметку сделал один генератор, а не независимые эксперты, –
        цифры показывают вклад в этом наборе, а не в жизни.
        {ab.rows.some((r) => r.signal === 'project' && r.measured) &&
          ' Проекты и созвоны в наборе смоделированы (у ~30 % и ~40 % профилей, с шумом ~10 %): это допущения, а не живые данные, поэтому их строки показывают механику, а не доказанный эффект.'}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Режим</th>
              <th className={styles.num}>P@5</th>
              <th className={styles.num}>nDCG@10</th>
              <th className={styles.num}>Δ P@5</th>
              <th className={styles.num}>Δ nDCG@10</th>
            </tr>
          </thead>
          <tbody>
            {ab.rows.map((r) => (
              <tr key={r.signal}>
                <td>{r.signal === 'full' ? r.label : `без: ${r.label}`}</td>
                <td className={styles.num}>{dec(r.p5.mean)}</td>
                <td className={styles.num}>{dec(r.ndcg10.mean)}</td>
                <td className={styles.num}>{!r.measured ? 'нет данных' : r.dP5 ? `${sign(r.dP5.mean)} (${sign(r.dP5.lo)}; ${sign(r.dP5.hi)})` : '–'}</td>
                <td className={styles.num}>{!r.measured ? 'нет данных' : r.dNdcg10 ? `${sign(r.dNdcg10.mean)} (${sign(r.dNdcg10.lo)}; ${sign(r.dNdcg10.hi)})` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CalibrationBlock({ cal }: { cal: NonNullable<MatchingResults['calibration']> }) {
  const r = cal.relevant;
  return (
    <>
      <h3>Калибровка: балл подбора и вероятность</h3>
      <p className={styles.soft}>
        Сам балл формулы – не вероятность: в бине «0,4–0,5» подходят ~90 % профилей, в бине «0,0–0,1» – 13 %. Мы пересчитываем балл в вероятность
        «кандидат релевантен» (изотоническая регрессия, кусочно-линейная таблица в коде). Разметка здесь синтетическая ({cal.profiles} профилей ×{' '}
        {cal.vacancies} вакансий, {cal.pairsShown} показанных пар, скрытая истина генератора), а не исходы реальных приглашений: цифры показывают,
        что механика работает, а не что вероятности верны в жизни. Таблица пересчитывается по исходам приглашений (eval/matching/outcomes.ts).
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Бин балла</th><th className={styles.num}>Средний балл</th><th className={styles.num}>Доля релевантных</th><th className={styles.num}>n</th></tr>
          </thead>
          <tbody>
            {r.curveBefore.map((b) => (
              <tr key={b.lo}>
                <td>{dec(b.lo)}–{dec(b.hi)}</td>
                <td className={styles.num}>{b.meanScore === null ? '–' : dec(b.meanScore)}</td>
                <td className={styles.num}>{b.share === null ? '–' : pct(b.share)}</td>
                <td className={styles.num}>{b.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Цель</th><th className={styles.num}>Brier до</th><th className={styles.num}>Brier после (кросс-проверка)</th><th className={styles.num}>ECE до</th><th className={styles.num}>ECE после</th></tr>
          </thead>
          <tbody>
            {([['Релевантен (≥ 1)', cal.relevant], ['Сильный (= 2)', cal.strong]] as const).map(([label, b]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className={styles.num}>{dec(b.holdout.brierBefore)}</td>
                <td className={styles.num}>{dec(b.holdout.brierAfter)}</td>
                <td className={styles.num}>{dec(b.before.ece)}</td>
                <td className={styles.num}>{dec(b.afterInSample.ece)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.soft}>
        Brier после: калибровка подобрана на половине вакансий, оценена на другой (и наоборот). ECE после – на всех парах, без отложенной выборки,
        поэтому оптимистична. Для цели «сильный» выигрыша на отложенной половине нет – показываем вероятность только для «релевантен».
      </p>
    </>
  );
}

/** Слепая разметка: два ИИ-размечающих разных моделей, κ и ours/BM25/базовая линия на A, B и консенсусе. */
function BlindBlock({ bl }: { bl: NonNullable<MatchingResults['blind']> }) {
  const sign = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(3).replace('.', ',')}`;
  const iv = (x: { mean: number; lo: number; hi: number }) => `${dec(x.mean)} (${dec(x.lo)}; ${dec(x.hi)})`;
  const sets = [
    ['Разметка A', bl.sets.a],
    ['Разметка B', bl.sets.b],
    ['Консенсус A и B', bl.sets.consensus],
    ...(bl.sets.generator ? [['Генератор (для сравнения)', bl.sets.generator] as const] : []),
  ] as const;
  return (
    <>
      <h3>Независимая разметка (слепая)</h3>
      <p className={styles.soft}>
        Оговорка: размечали два ИИ-агента разных моделей ({bl.labelers.a} и {bl.labelers.b}), не люди. {bl.vacancies} вакансий × {bl.pool} кандидатов
        ({bl.pairs} пар) – первые места объединённой выдачи нашего подбора и BM25. Размечающие видели только текст вакансии и профиля, без скрытой истины
        генератора и без баллов; кандидаты вне пула считаются нерелевантными. Согласие A и B – взвешенная κ Коэна {dec(bl.kappa.ab)}; с разметкой
        генератора: A {dec(bl.kappa.aVsGenerator)}, B {dec(bl.kappa.bVsGenerator)}. Интервалы – бутстреп по {bl.vacancies} вакансиям, поэтому широкие.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Разметка</th>
              <th>Метод</th>
              <th className={styles.num}>P@5</th>
              <th className={styles.num}>nDCG@10</th>
            </tr>
          </thead>
          <tbody>
            {sets.flatMap(([title, set]) => [
              ...Object.entries(set.methods).map(([m, x]) => (
                <tr key={`${title}-${m}`}>
                  <td>{title}</td>
                  <td>{METHOD_LABEL[m] ?? m}</td>
                  <td className={styles.num}>{iv(x.p5)}</td>
                  <td className={styles.num}>{iv(x.ndcg10)}</td>
                </tr>
              )),
              <tr key={`${title}-delta`}>
                <td>{title}</td>
                <td>Наш − BM25</td>
                <td className={styles.num}>{`${sign(set.deltaOursMinusBm25.p5.mean)} (${sign(set.deltaOursMinusBm25.p5.lo)}; ${sign(set.deltaOursMinusBm25.p5.hi)})`}</td>
                <td className={styles.num}>{`${sign(set.deltaOursMinusBm25.ndcg10.mean)} (${sign(set.deltaOursMinusBm25.ndcg10.lo)}; ${sign(set.deltaOursMinusBm25.ndcg10.hi)})`}</td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExtendedBlock({ title, ext }: { title: string; ext: MatchingExtended }) {
  const methods = Object.entries(ext.methods ?? {});
  const metrics = Object.keys(METRIC_LABEL).filter((m) => methods.some(([, v]) => typeof v[m as keyof typeof v] === 'number'));
  const deltas = [
    ['BM25', ext.deltaOursMinusBm25],
    ['базовая линия', ext.deltaOursMinusBaselineClaims],
  ] as const;
  if (!methods.length || !metrics.length) return null;
  return (
    <>
      <h3>{title}</h3>
      {(ext.vacancies || ext.profiles) && (
        <p className={styles.soft}>
          {ext.vacancies ?? '–'} вакансий × {ext.profiles ?? '–'} профилей.
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Метод</th>
              {metrics.map((m) => (
                <th key={m} className={styles.num}>
                  {METRIC_LABEL[m]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {methods.map(([name, v]) => (
              <tr key={name}>
                <td>{METHOD_LABEL[name] ?? name}</td>
                {metrics.map((m) => {
                  const x = v[m as keyof typeof v];
                  return (
                    <td key={m} className={styles.num}>
                      {typeof x === 'number' ? dec(x) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deltas.map(([name, d]) =>
        d && Object.keys(d).length ? (
          <p key={name} className={styles.soft}>
            Наш минус {name}, 95 % бутстреп-интервал:{' '}
            {Object.entries(d)
              .map(([m, i]) => `${METRIC_LABEL[m] ?? m} ${dec(i.mean)} [${dec(i.lo)}; ${dec(i.hi)}]`)
              .join(' · ')}
          </p>
        ) : null,
      )}
    </>
  );
}

/** Страница /validation: цифры теста на грейд и подбора, оговорки до цифр, команды воспроизведения. */
/** «Длина теста и надёжность»: перебор лимитов длины (ретест κ) и ширина банка по подкатегориям. */
function LengthBlock({ sweep, bank, itemLimits }: { sweep: LengthSweep | null; bank: BankWidth | null; itemLimits: ItemLimits }) {
  if (!sweep && !bank) return null;
  const opt = (x: number | null, f: (v: number) => string) => (x === null ? '–' : f(x));
  const len = (x: number) => x.toFixed(1).replace('.', ',');
  const short = bank ? bank.rows.filter((r) => bank.maxes.some((m) => (r.shortBy[String(m)] ?? 0) > 0 || (r.shortByRetest[String(m)] ?? 0) > 0)) : [];
  return (
    <>
      <h3 id="length">Длина теста и надёжность</h3>
      <p className={styles.soft}>
        Сейчас основная фаза – {formatItemRange(itemLimits)} заданий (+ дозадавание до 3). Длиннее тест – выше повторяемость, но жюри и кандидаты
        проходят его сами. Ниже – тот же движок с другими лимитами длины, остальное без изменений
        {sweep ? `: seed ${sweep.config.seed}, ${sweep.config.n} кандидатов на подкатегорию, модель ошибки «экземпляр»` : ''}. Ранняя остановка –
        основная фаза кончилась по уверенному решению раньше лимита.
      </p>
      {sweep && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Лимиты</th>
                <th className={styles.num}>κ ретеста, строгая (мин.)</th>
                <th className={styles.num}>κ ретеста, конкурентов</th>
                <th className={styles.num}>Совпадение решения</th>
                <th className={styles.num}>Длина, заданий</th>
                <th className={styles.num}>Ранние остановки</th>
                <th className={styles.num}>Ложное подтв. (конк.)</th>
                <th className={styles.num}>Минут (верхняя граница)</th>
              </tr>
            </thead>
            <tbody>
              {sweep.variants.map((v) => (
                <tr key={`${v.min}-${v.max}`}>
                  <td>
                    {v.min}–{v.max}
                    {v.current ? ' (сейчас)' : ''}
                  </td>
                  <td className={styles.num}>
                    {opt(v.strict.kappa, (x) => dec(x))} ({opt(v.strict.kappaMin, (x) => dec(x))})
                  </td>
                  <td className={styles.num}>{opt(v.competitor.kappa, (x) => dec(x))}</td>
                  <td className={styles.num}>{opt(v.strict.agreement, pct)}</td>
                  <td className={styles.num}>{opt(v.strict.lengthMean, len)}</td>
                  <td className={styles.num}>{opt(v.strict.earlyStopShare, pct)}</td>
                  <td className={styles.num}>{opt(v.competitor.falsePass, pct)}</td>
                  <td className={styles.num}>{opt(v.strict.minutesMean, len)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bank && (
        <p className={styles.soft}>
          Ширина банка: в попытке Junior/Middle достижимо {Math.min(...bank.rows.filter((r) => r.reachable > 0).map((r) => r.reachable))}–
          {Math.max(...bank.rows.map((r) => r.reachable))} заданий без повторов (свои семейства подкатегории + общие в пределах 30 %), этого хватает на
          любой вариант выше вместе с дозадаванием во всех {bank.rows.length} подкатегориях.{' '}
          {short.length > 0
            ? `Две попытки подряд без единого повторного семейства не помещаются в: ${short
                .map((r) => `${r.title} (${r.reachable}; при ${bank.maxes.filter((m) => (r.shortByRetest[String(m)] ?? 0) > 0).map((m) => `${m} – не хватает ${r.shortByRetest[String(m)]}`).join(', ')})`)
                .join('; ')}. Это не блокирует тест: ротация между попытками мягкая, растёт только доля повторённых семейств.`
            : 'Две попытки подряд без повторов помещаются везде.'}
        </p>
      )}
    </>
  );
}

export function ValidationView({
  grade,
  matching,
  juryLink = false,
  length,
  itemLimits = DEFAULT_ITEM_LIMITS,
}: {
  grade: GradeTestData;
  matching: MatchingResults;
  juryLink?: boolean;
  /** Блок «Длина теста и надёжность» (results.json: lengthSweep, bankWidth); не передан – блока нет. */
  length?: { sweep: LengthSweep | null; bank: BankWidth | null };
  itemLimits?: ItemLimits;
}) {
  const s = matching.summary;
  const persona = grade.synthetic.filter((r) => r.population === 'persona');
  const range = (xs: number[], f: (x: number) => string) => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
  };
  return (
    <main id="main">
      <Container size="default" className={styles.page}>
        {juryLink && <JuryBackLink />}
        <PageTitle
          kicker="Валидация"
          title="Как мы проверяем тест и подбор"
          lead="Цифры, на которых держатся категория кандидата и порядок выдачи работодателю. Сначала оговорки, потом числа и команды, которыми их можно повторить."
        />

        <Panel as="section" className={styles.section} aria-labelledby="caveats">
          <h2 id="caveats">Оговорки – читать до цифр</h2>
          <ul className={styles.list}>
            <li>
              <b>Все числа – синтетика и симуляция,</b> не измерение на людях. Живой разметки нет: тест не показывали реальным кандидатам.
            </li>
            <li>
              <b>Параметры заданий теста (a, b) – экспертные,</b> на людях не оценены. Симуляция проверяет механику при этих параметрах, а не то, что
              задания измеряют умение.
            </li>
            <li>
              <b>Разметку релевантности для подбора делал агент,</b> второго оценщика нет. Правило разметки близко к формуле подбора, поэтому цифры – проверка
              согласованности, а не независимая валидация.
            </li>
            <li>
              <b>Набор подбора маленький</b> ({s.profiles} профилей × {s.vacancies} вакансий), правила подбирались на нём же. Проверить на своих данных можно
              на странице «Проверить на своих данных».
            </li>
          </ul>
          <div className={styles.links}>
            <Button href="/evaluate" variant="cta" size="sm">
              Проверить подбор на своих данных
            </Button>
          </div>
        </Panel>

        <Panel as="section" className={styles.section} aria-labelledby="boundary">
          <h2 id="boundary">Что тест не защищает и как подтверждается умение</h2>
          <ul className={styles.list}>
            <li>
              <b>Тест не защищён от нейросети в соседнем окне.</b> Задание с числовым ответом решает любая современная модель, и мы не измеряли, насколько
              это ломает категорию. Поэтому категория из теста – результат короткого адаптивного теста, а не доказательство умения на практике.
            </li>
            <li>
              <b>Защищает он от слива ответов:</b> уникальные экземпляры каждого задания (генераторы) и ротация заданий между попытками. Подсмотренный у
              знакомого ответ не подходит к вашему экземпляру; от модели это не защищает.
            </li>
            <li>
              <b>Опыт дополнительно подтверждают три шага вне теста:</b> созвон с ИИ-интервьюером, проект на скрытых тестах и защита по собственному коду. Они
              необязательны и категорию не меняют: она остаётся за тестом.
            </li>
          </ul>
          <div className={styles.links}>
            <Button href="/interview" size="sm">
              Созвон с ИИ-интервьюером
            </Button>
            <Button href="/projects" size="sm">
              Проект и защита
            </Button>
          </div>
        </Panel>

        <section className={styles.section} aria-labelledby="grade">
          <h2 id="grade">Тест на грейд</h2>
          <p className={styles.soft}>Политика {grade.policy}. Источник чисел – {grade.doc}.</p>
          <div className={styles.stats}>
            <Stat value={range(persona.map((r) => r.retest), pct)} label={`совпадение исхода двух попыток (цель ${grade.targets.retest})`} />
            <Stat value={range(persona.map((r) => r.kappa), dec)} label={`κ Коэна, test-retest (цель ${grade.targets.kappa})`} />
            <Stat value={range(persona.map((r) => r.aucMiddleJunior), dec)} label={`AUC Middle против Junior (цель ${grade.targets.auc})`} />
            <Stat value={range(persona.map((r) => r.length), (x) => x.toFixed(1).replace('.', ','))} label={`заданий в среднем (${grade.targets.length})`} />
          </div>
          <p className={styles.soft}>
            Цели по повторяемости и разделению <b>не достигнуты</b>: короткий тест (SE оценки ≈ 0,45) не даёт 90 % совпадения. Повторяемость при тех же
            ответах – 100 % по построению (seed → задания, код → проверка).
          </p>

          <h3>Персоны по подкатегориям: вымышленные кандидаты, модель знаний задана агентом</h3>
          <p className={styles.soft}>
            Seed 1, 1000 попыток на персону и заявленный грейд в каждой из 18 подкатегорий, боевой движок теста без LLM и БД; в таблице – среднее по
            подкатегориям.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Персона</th>
                  <th>Уровень по легенде</th>
                  <th className={styles.num}>Заявил Junior: подтверждён</th>
                  <th className={styles.num}>Заявил Middle: подтверждён</th>
                  <th className={styles.num}>Заявил Senior: подтверждён</th>
                </tr>
              </thead>
              <tbody>
                {grade.personas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.id} – {p.legend}
                    </td>
                    <td>{p.truth}</td>
                    <td className={styles.num}>{dec(p.pJunior, 2)}</td>
                    <td className={styles.num}>{dec(p.pMiddle, 2)}</td>
                    <td className={styles.num}>{dec(p.pSenior, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.soft}>{PERSONA_NOTE}</p>

          <h3>θ-синтетика: 2000 кандидатов на подкатегорию, среднее по специализации</h3>
          <p className={styles.soft}>
            Две популяции: persona – подобрана по персонам, legacy – исходные допущения. Какая ближе к людям, неизвестно без живой разметки.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Популяция</th>
                  <th className={styles.num}>Ложное подтв. ({grade.targets.falseConfirm})</th>
                  <th className={styles.num}>Ложный отказ ({grade.targets.falseReject})</th>
                  <th className={styles.num}>Test-retest ({grade.targets.retest})</th>
                  <th className={styles.num}>κ* ({grade.targets.kappa})</th>
                  <th className={styles.num}>AUC M/J ({grade.targets.auc})</th>
                  <th className={styles.num}>Длина</th>
                  <th className={styles.num}>Утечка трюка 30 %</th>
                </tr>
              </thead>
              <tbody>
                {grade.synthetic.map((r) => (
                  <tr key={`${r.population}-${r.specialization}`}>
                    <td>
                      {r.population}, {r.specialization}
                    </td>
                    <td className={`${styles.num} ${r.falseConfirm > 0.1 ? styles.miss : ''}`}>{pct(r.falseConfirm)}</td>
                    <td className={`${styles.num} ${r.falseReject > 0.2 ? styles.miss : ''}`}>{pct(r.falseReject)}</td>
                    <td className={styles.num}>{pct(r.retest)}</td>
                    <td className={styles.num}>{dec(r.kappa, 2)}</td>
                    <td className={styles.num}>{dec(r.aucMiddleJunior)}</td>
                    <td className={styles.num}>{r.length.toFixed(2).replace('.', ',')}</td>
                    <td className={styles.num}>{pct(r.leak30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.soft}>
            * κ и AUC посчитаны на текущей механике с дозадаванием (политика v7). «Утечка трюка» – атака: кандидат заранее знает решение 30 % шаблонов;
            ложное подтверждение растёт, защита держится на разных экземплярах заданий и ротации семейств между попытками.
          </p>
          {length && <LengthBlock sweep={length.sweep} bank={length.bank} itemLimits={itemLimits} />}
          <h3>Как повторить (из platform/, ≈ 50 с полный прогон, без сети и БД)</h3>
          <pre className={styles.code}>{grade.commands.join('\n')}</pre>
        </section>

        <section className={styles.section} aria-labelledby="matching">
          <h2 id="matching">Подбор кандидатов работодателю</h2>
          <p className={styles.soft}>
            Тот же код ранжирования, что в кабинете работодателя, на {s.profiles} синтетических профилях × {s.vacancies} демо-вакансиях. Базовая линия –
            «больше подтверждённых утверждений своей специализации – выше», без учёта требований вакансии. Числа читаются из закоммиченного
            eval/matching/results.json.
          </p>
          <div className={styles.stats}>
            <Stat value={dec(s.precisionAt5)} label={`Precision@${s.k}: наш подбор (потолок ${dec(s.precisionAt5Ceiling)})`} />
            <Stat value={dec(s.baseline.precisionAt5)} label={`Precision@${s.k}: базовая линия`} />
            <Stat value={dec(s.ndcgAt5)} label={`nDCG@${s.k}: наш подбор`} />
            <Stat value={dec(s.baseline.ndcgAt5)} label={`nDCG@${s.k}: базовая линия`} />
          </div>
          <p className={styles.soft}>
            Потолок P@{s.k} ниже 1: у части вакансий релевантных меньше {s.k}. Релевантность 0/1/2 – nDCG учитывает степень.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Вакансия</th>
                  <th className={styles.num}>P@{s.k}</th>
                  <th className={styles.num}>потолок</th>
                  <th className={styles.num}>nDCG@{s.k}</th>
                  <th className={styles.num}>база P@{s.k}</th>
                  <th className={styles.num}>база nDCG@{s.k}</th>
                </tr>
              </thead>
              <tbody>
                {matching.rows.map((r) => (
                  <tr key={r.vacancy}>
                    <td className={styles.mono}>{r.vacancy}</td>
                    <td className={styles.num}>{dec(r.p)}</td>
                    <td className={styles.num}>{dec(r.pMax)}</td>
                    <td className={styles.num}>{dec(r.ndcg)}</td>
                    <td className={styles.num}>{dec(r.bP)}</td>
                    <td className={styles.num}>{dec(r.bNdcg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matching.legacyExtended && <ExtendedBlock title="Тот же набор: BM25, случайный порядок, интервалы" ext={matching.legacyExtended} />}
          {matching.extended && <ExtendedBlock title="Расширенная синтетика" ext={matching.extended} />}
          {matching.ablation && <AblationBlock ab={matching.ablation} />}
          {matching.calibration && <CalibrationBlock cal={matching.calibration} />}
          {matching.blind && <BlindBlock bl={matching.blind} />}
          <h3>Как повторить (из platform/, без БД и сети)</h3>
          <pre className={styles.code}>{'npx tsx eval/matching/run.ts --no-write\nnpx tsx eval/matching/ablation.ts --no-write\nnpx tsx eval/matching/blind-eval.ts --no-write\nnpx tsx eval/matching/calibration.ts --no-write'}</pre>
          <p className={styles.soft}>
            Свой набор вакансий, кандидатов и разметки можно прогнать через то же ранжирование прямо на сайте – страница «Проверить на своих данных» (/evaluate)
            или POST /api/evaluate.
          </p>
        </section>
      </Container>
    </main>
  );
}
