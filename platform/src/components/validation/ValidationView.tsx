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
          <h3>Как повторить (из platform/, без БД и сети)</h3>
          <pre className={styles.code}>npx tsx eval/matching/run.ts --no-write</pre>
          <p className={styles.soft}>
            Свой набор вакансий, кандидатов и разметки можно прогнать через то же ранжирование прямо на сайте — страница «Проверить на своих данных» (/evaluate)
            или POST /api/evaluate.
          </p>
        </section>
      </Container>
    </main>
  );
}
