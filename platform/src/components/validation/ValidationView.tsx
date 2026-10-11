import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Panel } from '@/components/ui';
import type { PersonaRow, SyntheticRow } from '@/server/validation/grade-test-figures';
import type { MatchingExtended, MatchingResults } from '@/server/validation/matching-results';

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
        {ab.vacancies} вакансий × {ab.profiles} профилей. Сигнал выключаем по одному, остальная формула прежняя; Δ — разница с полной формулой
        (минус — сигнал помогает), в скобках 95 % интервал (парный бутстреп по вакансиям). Разметку сделал один генератор, а не независимые эксперты, —
        цифры показывают вклад в этом наборе, а не в жизни.
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
                <td className={styles.num}>{!r.measured ? 'нет данных' : r.dP5 ? `${sign(r.dP5.mean)} (${sign(r.dP5.lo)}; ${sign(r.dP5.hi)})` : '—'}</td>
                <td className={styles.num}>{!r.measured ? 'нет данных' : r.dNdcg10 ? `${sign(r.dNdcg10.mean)} (${sign(r.dNdcg10.lo)}; ${sign(r.dNdcg10.hi)})` : '—'}</td>
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
        Сам балл формулы — не вероятность: в бине «0,4–0,5» подходят ~90 % профилей, в бине «0,0–0,1» — 13 %. Мы пересчитываем балл в вероятность
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
                <td className={styles.num}>{b.meanScore === null ? '—' : dec(b.meanScore)}</td>
                <td className={styles.num}>{b.share === null ? '—' : pct(b.share)}</td>
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
        Brier после: калибровка подобрана на половине вакансий, оценена на другой (и наоборот). ECE после — на всех парах, без отложенной выборки,
        поэтому оптимистична. Для цели «сильный» выигрыша на отложенной половине нет — показываем вероятность только для «релевантен».
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
        ({bl.pairs} пар) — первые места объединённой выдачи нашего подбора и BM25. Размечающие видели только текст вакансии и профиля, без скрытой истины
        генератора и без баллов; кандидаты вне пула считаются нерелевантными. Согласие A и B — взвешенная κ Коэна {dec(bl.kappa.ab)}; с разметкой
        генератора: A {dec(bl.kappa.aVsGenerator)}, B {dec(bl.kappa.bVsGenerator)}. Интервалы — бутстреп по {bl.vacancies} вакансиям, поэтому широкие.
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
          {ext.vacancies ?? '—'} вакансий × {ext.profiles ?? '—'} профилей.
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
                      {typeof x === 'number' ? dec(x) : '—'}
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
export function ValidationView({ grade, matching, juryLink = false }: { grade: GradeTestData; matching: MatchingResults; juryLink?: boolean }) {
  const s = matching.summary;
  const persona = grade.synthetic.filter((r) => r.setting === 'strict');
  const cell = ([mean, lo, hi]: [number, number, number]) => `${dec(mean, 2)} (${dec(lo, 2)}–${dec(hi, 2)})`;
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
          <h2 id="caveats">Оговорки — читать до цифр</h2>
          <ul className={styles.list}>
            <li>
              <b>Все числа — синтетика и симуляция,</b> не измерение на людях. Живой разметки нет: тест не показывали реальным кандидатам.
            </li>
            <li>
              <b>Параметры заданий теста (a, b) — экспертные,</b> на людях не оценены. Симуляция проверяет механику при этих параметрах, а не то, что
              задания измеряют умение.
            </li>
            <li>
              <b>Разметку релевантности для подбора делал агент,</b> второго оценщика нет. Правило разметки близко к формуле подбора, поэтому цифры — проверка
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
              это ломает категорию. Поэтому тест — предварительная калибровка грейда, а не доказательство умения.
            </li>
            <li>
              <b>Защищает он от слива ответов:</b> уникальные экземпляры каждого задания (генераторы) и ротация заданий между попытками. Подсмотренный у
              знакомого ответ не подходит к вашему экземпляру; от модели это не защищает.
            </li>
            <li>
              <b>Умение подтверждают три шага вне теста:</b> созвон с ИИ-интервьюером, проект на скрытых тестах и защита по собственному коду.
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
          <p className={styles.soft}>
            Политика {grade.policy}. Заголовочные числа — строгая постановка, среднее по подкатегориям. Источник — eval/test/results.json и {grade.doc}.
          </p>
          <div className={styles.stats}>
            <Stat value={range(persona.map((r) => r.retest), pct)} label={`совпадение исхода двух попыток (цель ${grade.targets.retest})`} />
            <Stat value={range(persona.map((r) => r.kappa), dec)} label={`κ Коэна, test-retest (цель ${grade.targets.kappa})`} />
            <Stat value={range(persona.map((r) => r.aucMiddleJunior), dec)} label={`AUC Middle против Junior (цель ${grade.targets.auc})`} />
            <Stat value={range(persona.map((r) => r.length), (x) => x.toFixed(1).replace('.', ','))} label={`заданий в среднем (${grade.targets.length})`} />
          </div>
          <p className={styles.soft}>
            Цели по повторяемости, разделению и ложному подтверждению в строгой постановке <b>не достигнуты</b>: тест на 8–9 заданий не даёт 90 %
            совпадения двух попыток, а популяции Junior и Middle пересекаются. В постановке конкурентов ложное подтверждение укладывается в 10 %, но
            ретест и AUC тоже ниже целей. Повторяемость при тех же ответах — 100 % по построению (seed → задания, код → проверка).
          </p>

          <h3>Персоны: вымышленные кандидаты, модель знаний задана агентом</h3>
          <p className={styles.soft}>
            Профили знаний по семействам подкатегории, не легенды людей. Seed 1, 1000 попыток на персону и заявленный грейд, {grade.personas.length} профилей ×
            18 подкатегорий, боевой движок теста без LLM и БД. В ячейках среднее по подкатегориям и (минимум–максимум).
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Персона</th>
                  <th>Уровень по легенде</th>
                  <th className={styles.num}>Заявил Junior: подтверждён</th>
                  <th className={styles.num}>Заявил Middle: подтверждён</th>
                </tr>
              </thead>
              <tbody>
                {grade.personas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.id} — {p.legend}
                    </td>
                    <td>{p.truth}</td>
                    <td className={styles.num}>{cell(p.pJunior)}</td>
                    <td className={styles.num}>{cell(p.pMiddle)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.soft}>
            Новички не должны получать Junior чаще 10 %: пограничный новичок N1 получает его в среднем в 6 % случаев, на худшей подкатегории — в 20 %
            (цель не достигнута). Junior, заявивший Middle, ложно подтверждается в среднем в 6 % случаев, на худшей — в 15 %. Уверенные Middle и Senior
            проходят почти всегда.
          </p>

          <h3>θ-синтетика: 2000 кандидатов на подкатегорию</h3>
          <p className={styles.soft}>
            Две постановки метрик: строгая — истина это метка популяции, и популяции пересекаются; конкурентов — истина это θ выше порога заявленного
            грейда. Среднее по {grade.synthetic[0]?.subcategories} подкатегориям, модель ошибки «экземпляр». Какая постановка ближе к людям, неизвестно без
            живой разметки.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Постановка</th>
                  <th className={styles.num}>Ложное подтв. ({grade.targets.falseConfirm})</th>
                  <th className={styles.num}>Ложный отказ ({grade.targets.falseReject})</th>
                  <th className={styles.num}>Test-retest ({grade.targets.retest})</th>
                  <th className={styles.num}>κ* ({grade.targets.kappa})</th>
                  <th className={styles.num}>AUC M/J ({grade.targets.auc})</th>
                  <th className={styles.num}>AUC J/новичок</th>
                  <th className={styles.num}>Длина</th>
                  <th className={styles.num}>Утечка трюка 30 %</th>
                </tr>
              </thead>
              <tbody>
                {grade.synthetic.map((r) => (
                  <tr key={r.setting}>
<td>{r.label}</td>
                    <td className={`${styles.num} ${r.falseConfirm > 0.1 ? styles.miss : ''}`}>{pct(r.falseConfirm)}</td>
                    <td className={`${styles.num} ${r.falseReject > 0.2 ? styles.miss : ''}`}>{pct(r.falseReject)}</td>
                    <td className={styles.num}>{pct(r.retest)}</td>
                    <td className={styles.num}>{dec(r.kappa, 2)}</td>
                    <td className={styles.num}>{dec(r.aucMiddleJunior)}</td>
                    <td className={styles.num}>{r.aucJuniorNovice === null ? '—' : dec(r.aucJuniorNovice)}</td>
                    <td className={styles.num}>{r.length.toFixed(2).replace('.', ',')}</td>
                    <td className={styles.num}>{r.leak30 === null ? '—' : pct(r.leak30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.soft}>
            «Утечка трюка» — атака: кандидат заранее знает решение 30 % шаблонов; ложное подтверждение растёт, защита держится на разных экземплярах
            заданий и ротации семейств между попытками. Прочерк — метрика в этой постановке не считается. Пересдача после разбора и лучшая из 3 попыток —
            в docs/validation-results.md, «Версии политики теста на грейд».
          </p>
          <h3>Как повторить (из platform/, без сети и LLM; run.ts ≈ 3 мин, персоны ≈ 1 мин на направление)</h3>
          <pre className={styles.code}>{grade.commands.join('\n')}</pre>
        </section>

        <section className={styles.section} aria-labelledby="matching">
          <h2 id="matching">Подбор кандидатов работодателю</h2>
          <p className={styles.soft}>
            Тот же код ранжирования, что в кабинете работодателя, на {s.profiles} синтетических профилях × {s.vacancies} демо-вакансиях. Базовая линия —
            «больше подтверждённых утверждений своей специализации — выше», без учёта требований вакансии. Числа читаются из закоммиченного
            eval/matching/results.json.
          </p>
          <div className={styles.stats}>
            <Stat value={dec(s.precisionAt5)} label={`Precision@${s.k}: наш подбор (потолок ${dec(s.precisionAt5Ceiling)})`} />
            <Stat value={dec(s.baseline.precisionAt5)} label={`Precision@${s.k}: базовая линия`} />
            <Stat value={dec(s.ndcgAt5)} label={`nDCG@${s.k}: наш подбор`} />
            <Stat value={dec(s.baseline.ndcgAt5)} label={`nDCG@${s.k}: базовая линия`} />
          </div>
          <p className={styles.soft}>
            Потолок P@{s.k} ниже 1: у части вакансий релевантных меньше {s.k}. Релевантность 0/1/2 — nDCG учитывает степень.
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
            Свой набор вакансий, кандидатов и разметки можно прогнать через то же ранжирование прямо на сайте — страница «Проверить на своих данных» (/evaluate)
            или POST /api/evaluate.
          </p>
        </section>
      </Container>
    </main>
  );
}
