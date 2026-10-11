import Link from 'next/link';
import type { ReactNode } from 'react';

import { JuryBackLink } from '@/components/demo/JuryRoute';
import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Panel, Tag } from '@/components/ui';
import { GRADE_LABEL, GRADES, type Grade } from '@/lib/grades';
import type { EvidenceLevel } from '@/server/claims/types';
import {
  CALL_TOPIC_BONUS,
  CALL_TOPIC_BONUS_MAX,
  CATEGORY_BASE,
  CATEGORY_MULT_ABOVE,
  CATEGORY_MULT_EXACT,
  FSP_BOOST_MAX,
  FSP_HALF_LIFE_YEARS,
  FSP_PER_POINT,
  PROJECT_BONUS_PER_SCORE,
  SPEC_MISMATCH_PENALTY,
  STACK_BOOST_MAX,
  STACK_BOOST_PER_TAG,
  STACK_PARTIAL_MAX_COEF,
} from '@/server/employer/weights';
import { ADJACENT_FACTOR, LEVEL_WEIGHT } from '@/server/recommend/weights';
import { PERSONA_ROWS, type BankInformation, type MethodPolicy, type PersonaRow, type PersonaStats } from '@/server/validation/method';
import type { SimSubcategory } from '@/server/validation/simulator';

import { dec, pct } from '../validation/format';

import { InfoChart, SeChart } from './InfoChart';
import styles from './Method.module.css';

export interface MethodScreenProps {
  policy: MethodPolicy;
  subcategories: SimSubcategory[];
  selected: SimSubcategory | null;
  info: BankInformation | null;
  personas: PersonaStats[] | null;
  juryLink?: boolean;
}

const LEVEL_TEXT: Record<EvidenceLevel, string> = {
  self_reported: 'со слов',
  artifact: 'артефакт',
  third_party: 'третья сторона',
  platform: 'платформа',
};

function Const({ children }: { children: ReactNode }) {
  return (
    <Tag tone="outline" className={styles.mono}>
      {children}
    </Tag>
  );
}

function Flow({ p }: { p: MethodPolicy }) {
  const cut = (g: Grade) => `${GRADE_LABEL[g]} ${dec(p.cuts[g], 1)}`;
  return (
    <ol className={styles.flow} aria-label="Этапы теста">
      <li className={styles.flowStep}>
        <span className={styles.flowNum} aria-hidden="true">
          1
        </span>
        <div>
          <p className={styles.flowTitle}>Старт по заявленному грейду</p>
          <p className={styles.flowText}>
            Кандидат выбирает подкатегорию и грейд. Пул — задания своей подкатегории и общие (не больше {pct(p.maxCommonShare)} попытки). Стартовая оценка θ₀:
            Junior и Middle — {dec(p.startTheta.junior, 1)}, Senior — {dec(p.startTheta.senior, 1)}; у Senior основная фаза только по Senior-заданиям, не больше{' '}
            {p.seniorMainMax}.
          </p>
          <div className={styles.flowConst}>
            <Const>START_THETA</Const>
            <Const>MAX_COMMON_SHARE = {dec(p.maxCommonShare, 1)}</Const>
          </div>
        </div>
      </li>
      <li className={styles.loop}>
        <span className={styles.loopLabel}>Цикл после каждого ответа</span>
        <ol className={styles.flow}>
          <li className={styles.flowStep}>
            <span className={styles.flowNum} aria-hidden="true">
              2
            </span>
            <div>
              <p className={styles.flowTitle}>Выбор задания по информации Фишера</p>
              <p className={styles.flowText}>
                Для каждого непоказанного задания считается I(θ̂) = a²·P·(1 − P) при текущей оценке. Показывается случайное из {p.randomesque} самых
                информативных (randomesque: задания не выучить по порядку), не больше {pct(p.maxSharePerCatalog)} попытки на одно утверждение каталога.
              </p>
              <div className={styles.flowConst}>
                <Const>RANDOMESQUE = {p.randomesque}</Const>
              </div>
            </div>
          </li>
          <li className={styles.flowStep}>
            <span className={styles.flowNum} aria-hidden="true">
              3
            </span>
            <div>
              <p className={styles.flowTitle}>Оценка θ по сетке</p>
              <p className={styles.flowText}>
                Модель 2PL: P(верно) = 1 / (1 + e<sup>−a(θ − b)</sup>). После ответа апостериорное распределение θ пересчитывается на сетке из {p.grid.size}{' '}
                узла от {p.grid.min} до {p.grid.max} с априорным N(0, 1): θ̂ — среднее, SE — стандартное отклонение.
              </p>
            </div>
          </li>
          <li className={styles.flowStep}>
            <span className={styles.flowNum} aria-hidden="true">
              4
            </span>
            <div>
              <p className={styles.flowTitle}>Остановка</p>
              <p className={styles.flowText}>
                Не раньше {p.minItems} заданий. Стоп, если P(θ &gt; порог заявленного грейда) ≥ {dec(p.earlyStop, 1)} или ≤ {dec(1 - p.earlyStop, 1)}, или SE ≤{' '}
                {dec(p.seStop, 1)}, или показано {p.maxItems} заданий. Иначе — снова шаг 2.
              </p>
              <div className={styles.flowConst}>
                <Const>MIN_ITEMS = {p.minItems}</Const>
                <Const>MAX_ITEMS = {p.maxItems}</Const>
                <Const>EARLY_STOP_PROB = {dec(p.earlyStop, 1)}</Const>
                <Const>SE_STOP = {dec(p.seStop, 1)}</Const>
              </div>
            </div>
          </li>
        </ol>
      </li>
      <li className={styles.flowStep}>
        <span className={styles.flowNum} aria-hidden="true">
          5
        </span>
        <div>
          <p className={styles.flowTitle}>Дозадавание</p>
          <p className={styles.flowText}>
            Если по грейду ниже заявленного решение неуверенное, тест добирает до {p.juniorProbeMax} Junior-заданий (у заявки Senior — до {p.middleProbeMax}{' '}
            Middle). Так «Junior в один клик» и «Middle в один клик» опираются на достаточное число наблюдений.
          </p>
          <div className={styles.flowConst}>
            <Const>JUNIOR_PROBE_MAX = {p.juniorProbeMax}</Const>
            <Const>MIDDLE_PROBE_MAX = {p.middleProbeMax}</Const>
          </div>
        </div>
      </li>
      <li className={`${styles.flowStep} ${styles.flowFinal}`}>
        <span className={styles.flowNum} aria-hidden="true">
          6
        </span>
        <div>
          <p className={styles.flowTitle}>Вердикт: категория = специализация × грейд</p>
          <p className={styles.flowText}>
            Грейд подтверждён, если P(θ &gt; порог) ≥ {dec(p.confirmProb, 1)} по всем ответам попытки. Пороги на шкале θ: {GRADES.map(cut).join(', ')}. Не
            подтвердился — предлагается грейд ниже, если он подтверждается той же попыткой. Подозрение на помощь нейросети (индекс честности high) отправляет на
            короткий подтверждающий тест.
          </p>
          <div className={styles.flowConst}>
            <Const>CONFIRM_PROB = {dec(p.confirmProb, 1)}</Const>
            <Const>GRADE_CUT</Const>
          </div>
        </div>
      </li>
    </ol>
  );
}

function Picker({ subcategories, selected }: { subcategories: SimSubcategory[]; selected: SimSubcategory | null }) {
  const bySpec = new Map<string, SimSubcategory[]>();
  for (const s of subcategories) bySpec.set(s.specializationTitle, [...(bySpec.get(s.specializationTitle) ?? []), s]);
  return (
    <form method="get" action="/method" className={styles.picker} aria-label="Подкатегория для графиков и симуляции">
      <label className={styles.pickerField}>
        <span className={styles.pickerLabel}>Направление и подкатегория</span>
        <select name="sub" className={styles.select} defaultValue={selected?.id}>
          {[...bySpec.entries()].map(([spec, subs]) => (
            <optgroup key={spec} label={spec}>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <Button type="submit" variant="ghost">
        Показать
      </Button>
    </form>
  );
}

function Bank({ info, policy }: { info: BankInformation; policy: MethodPolicy }) {
  const range = info.preciseRange;
  return (
    <>
      <ul className={styles.legend} aria-label="Легенда графика">
        <li>
          <span className={`${styles.swatch} ${styles.swBest}`} aria-hidden="true" />
          {policy.maxItems} лучших заданий при каждом θ (потолок одной попытки)
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.swJunior}`} aria-hidden="true" />
          Junior-задания банка ({info.counts.junior})
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.swMiddle}`} aria-hidden="true" />
          Middle ({info.counts.middle})
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.swSenior}`} aria-hidden="true" />
          Senior ({info.counts.senior})
        </li>
      </ul>
      <InfoChart info={info} cuts={policy.cuts} maxItems={policy.maxItems} />
      <p className={styles.soft}>
        Задание даёт больше всего информации там, где θ ≈ b (его сложность): кривые грейдов стоят каждая у своего порога, поэтому банк различает уровни на всех
        трёх границах, а не только в середине. Лучше всего тест различает при θ ≈ {dec(info.peakTheta, 1)}.
      </p>
      <h3>Точность: стандартная ошибка оценки</h3>
      <SeChart info={info} cuts={policy.cuts} seStop={policy.seStop} />
      <p className={styles.soft}>
        {range
          ? `SE ≤ ${dec(policy.seStop, 1)} достижима при θ от ${dec(range[0], 1)} до ${dec(range[1], 1)}: у порогов грейдов оценка точнее всего, по краям шкалы — грубее, но там и решение о грейде однозначное.`
          : `SE ≤ ${dec(policy.seStop, 1)} за ${policy.maxItems} заданий не достигается ни при каком θ: тест останавливается по уверенности решения о грейде (P ≥ ${dec(policy.earlyStop, 1)}), а не по точности θ.`}
      </p>
      <p className={styles.note}>
        Кривые — по параметрам a и b заданий банка этой подкатегории (свои семейства и общие). Параметры экспертные, на людях не откалиброваны.
      </p>
    </>
  );
}

const VERDICTS: { key: Grade | 'none'; label: string; cls: string }[] = [
  { key: 'none', label: 'не подтверждён', cls: styles.stackNone! },
  { key: 'junior', label: 'Junior', cls: styles.stackJunior! },
  { key: 'middle', label: 'Middle', cls: styles.stackMiddle! },
  { key: 'senior', label: 'Senior', cls: styles.stackSenior! },
];

const ROW_TITLE: Record<PersonaRow, string> = { mid: 'Середина зоны грейда', confident: 'Уверенный: верхняя треть зоны' };
const ROW_TEXT: Record<PersonaRow, string> = {
  mid: 'θ посередине между порогами своего грейда; у новичка и Senior — на 0,6 и 0,5 от порога.',
  confident: 'θ в верхней трети зоны своего грейда; новичок — глубже в своей зоне, Senior — дальше от порога.',
};

function Personas({ personas }: { personas: PersonaStats[] }) {
  return (
    <ul className={styles.cards}>
      {personas.map((p) => (
        <li key={p.id}>
          <Panel as="div" className={styles.card}>
            <div className={styles.cardHead}>
              <p className={styles.cardTitle}>{p.title}</p>
              <span className={styles.cardMeta}>
                θ = {dec(p.theta, 2)} · заявка {GRADE_LABEL[p.claimed]}
              </span>
            </div>
            <div>
              <div className={styles.big}>{pct(p.confirmRate)}</div>
              <div className={styles.bigLabel}>
                подтверждён {GRADE_LABEL[p.claimed]} · {p.expect.toLowerCase()}
              </div>
            </div>
            <dl className={styles.metrics}>
              <dt>Заданий в среднем</dt>
              <dd>
                {dec(p.meanLength, 1)} ({p.minLength}–{p.maxLength})
              </dd>
              <dt>Итоговый SE</dt>
              <dd>{dec(p.meanSe, 2)}</dd>
              <dt>Ошибка |θ̂ − θ|</dt>
              <dd>{dec(p.meanAbsError, 2)}</dd>
              <dt>Грейд завышен</dt>
              <dd>{pct(p.overRate)}</dd>
              <dt>Грейд занижен</dt>
              <dd>{pct(p.underRate)}</dd>
            </dl>
            <div className={styles.stack} role="img" aria-label={`Вердикты: ${VERDICTS.map((v) => `${v.label} ${pct(p.verdicts[v.key])}`).join(', ')}`}>
              {VERDICTS.map((v) => (p.verdicts[v.key] > 0 ? <span key={v.key} className={v.cls} style={{ width: `${p.verdicts[v.key] * 100}%` }} /> : null))}
            </div>
            <p className={styles.stackLegend}>
              {VERDICTS.filter((v) => p.verdicts[v.key] > 0)
                .map((v) => `${v.label} ${pct(p.verdicts[v.key])}`)
                .join(' · ')}
            </p>
          </Panel>
        </li>
      ))}
    </ul>
  );
}

function Weights() {
  const categoryMax = (1 + CATEGORY_BASE) * (1 + CATEGORY_MULT_EXACT) - 1;
  const bars: { name: string; value: number; text: string }[] = [
    {
      name: 'Покрытие требований',
      value: 1,
      text: `Σ вес требования × зачёт / Σ весов. Зачёт по доказанности: ${(Object.keys(LEVEL_WEIGHT) as EvidenceLevel[]).map((l) => `${LEVEL_TEXT[l]} ${dec(LEVEL_WEIGHT[l], 2)}`).join(' · ')}; смежное утверждение × ${dec(ADJACENT_FACTOR, 1)}.`,
    },
    {
      name: 'Категория из теста',
      value: categoryMax,
      text: `(покрытие + ${dec(CATEGORY_BASE, 2)}) × (1 + множитель) − покрытие: грейд равен требуемому — × ${dec(1 + CATEGORY_MULT_EXACT, 1)}, выше — × ${dec(1 + CATEGORY_MULT_ABOVE, 1)}, ниже — без прибавки. До +${dec(categoryMax, 3)} при полном покрытии.`,
    },
    {
      name: 'Проект под потребность',
      value: PROJECT_BONUS_PER_SCORE,
      text: `${dec(PROJECT_BONUS_PER_SCORE, 2)} × доля пройденных скрытых тестов проекта под эту вакансию.`,
    },
    {
      name: 'Темы созвона',
      value: CALL_TOPIC_BONUS_MAX,
      text: `+${dec(CALL_TOPIC_BONUS, 2)} за тему потребности, подтверждённую на созвоне, не больше ${dec(CALL_TOPIC_BONUS_MAX, 2)}.`,
    },
    {
      name: 'Достижения ФСП',
      value: FSP_BOOST_MAX,
      text: `Σ место × уровень соревнования × 0,5^(давность / ${FSP_HALF_LIFE_YEARS} года) × ${dec(FSP_PER_POINT, 2)}, потолок ${dec(FSP_BOOST_MAX, 2)}. Нет истории ФСП — 0, не штраф.`,
    },
    {
      name: 'Стек в цитатах',
      value: STACK_BOOST_MAX,
      text: `+${dec(STACK_BOOST_PER_TAG, 2)} за метку стека в подтверждённых цитатах; близкая технология — доля до ${dec(STACK_PARTIAL_MAX_COEF, 1)}; потолок ${dec(STACK_BOOST_MAX, 2)}.`,
    },
    {
      name: 'Другая специализация',
      value: -SPEC_MISMATCH_PENALTY,
      text: `−${dec(SPEC_MISMATCH_PENALTY, 1)}, если специализация кандидата не совпала с потребностью.`,
    },
  ];
  return (
    <>
      <p className={styles.formula}>балл = покрытие + категория + проект + созвон + ФСП + стек − другая специализация</p>
      <ul className={styles.bars} aria-label="Максимальный вклад слагаемых балла">
        {bars.map((b) => (
          <li key={b.name} className={styles.bar}>
            <span className={styles.barName}>
              {b.name}: {b.value < 0 ? '−' : 'до +'}
              {dec(Math.abs(b.value), 2)}
            </span>
            <span className={styles.barTrack} aria-hidden="true">
              <span className={`${styles.barFill} ${b.value < 0 ? styles.barNeg : ''}`} style={{ width: `${Math.abs(b.value) * 100}%` }} />
            </span>
            <p className={styles.barText}>{b.text}</p>
          </li>
        ))}
      </ul>
      <ul className={styles.list}>
        <li>
          Порядок выдачи: сначала кандидаты точной подкатегории, затем соседней; внутри — по баллу, при равенстве — больше закрытых и доказанных требований.
        </li>
        <li>Без единого закрытого требования кандидат не показывается — кроме того, чья категория из теста совпала с потребностью.</li>
        <li>
          Флаг честности: если у попытки, давшей категорию, индекс честности high и она не подтверждена ни подтверждающим тестом, ни созвоном, категория в балл
          не идёт — кандидат ранжируется только по доказанным требованиям.
        </li>
        <li>
          Слагаемые ФСП, стека и созвона намеренно меньше одного закрытого требования: они уточняют порядок среди близких, но не поднимают над тем, кто
          доказанно закрыл больше.
        </li>
      </ul>
      <p className={styles.note}>Веса — наши предложения, калибруются прогоном на размеченном наборе (/evaluate, /validation).</p>
    </>
  );
}

/** /method — «Как устроена проверка»: этапы теста, информация банка, смоделированные кандидаты, формула подбора. */
export function MethodScreen({ policy, subcategories, selected, info, personas, juryLink }: MethodScreenProps) {
  const runs = personas?.[0]?.runs ?? 0;
  const avgSe = personas?.length ? personas.reduce((s, p) => s + p.meanSe, 0) / personas.length : 0;
  return (
    <main id="main">
      <Container size="default" className={styles.page}>
        {juryLink && <JuryBackLink />}
        <PageTitle
          kicker="Для жюри"
          title="Как устроена проверка"
          lead="Как адаптивный тест выносит категорию «специализация × грейд», где он различает уровни точнее всего, как ведёт себя на смоделированных кандидатах и как подбор ранжирует их для работодателя. Числа берутся из того же кода, что работает в тесте и в кабинете компании."
        />

        <section className={styles.section} aria-labelledby="m-flow">
          <h2 id="m-flow">1. Этапы теста</h2>
          <p className={styles.soft}>
            Политика <span className={styles.mono}>{policy.version}</span>. Длина попытки — от {policy.minItems} до {policy.maxItems} заданий плюс дозадавание.
          </p>
          <Flow p={policy} />
        </section>

        <section className={styles.section} aria-labelledby="m-bank">
          <h2 id="m-bank">2. Где тест различает лучше всего</h2>
          <Picker subcategories={subcategories} selected={selected} />
          {selected && (
            <p className={styles.note}>
              {selected.specializationTitle} · {selected.title}
            </p>
          )}
          {info ? <Bank info={info} policy={policy} /> : <p className={styles.soft}>Для этой подкатегории банка заданий нет.</p>}
        </section>

        <section className={styles.section} aria-labelledby="m-personas">
          <h2 id="m-personas">3. Смоделированные кандидаты</h2>
          <p className={styles.soft}>
            Две четвёрки виртуальных кандидатов с заданным «истинным» уровнем θ, по {runs} прогонов каждый (seed 1…{runs}) через тот же движок, что и боевой
            тест. Подкатегория — выбранная выше.
          </p>
          {personas ? (
            PERSONA_ROWS.map((row) => (
              <div key={row} className={styles.section}>
                <h3>{ROW_TITLE[row]}</h3>
                <p className={styles.note}>{ROW_TEXT[row]}</p>
                <Personas personas={personas.filter((p) => p.row === row)} />
              </div>
            ))
          ) : (
            <p className={styles.soft}>Для этой подкатегории теста нет.</p>
          )}
          {personas && (
            <p className={styles.note}>
              Тест осторожный: грейд подтверждается только при P(θ &gt; порог) ≥ {dec(policy.confirmProb, 1)}, поэтому ошибается он чаще в сторону занижения,
              чем завышения. Зона Junior узкая ({dec(policy.cuts.middle - policy.cuts.junior, 1)} по θ) при итоговом SE около {dec(avgSe, 1)}, и кандидат в
              середине зоны подтверждается не всегда, а уверенный — заметно чаще. Разница между двумя строками и есть осторожность теста: сомнение решается в пользу
              грейда ниже. Те же выводы — в цифрах валидации.
            </p>
          )}
          <p className={styles.note}>
            Это симуляция по модели, не люди: ответы порождает логистическая модель IRT с параметрами, которые заданы экспертно и на людях не откалиброваны. Без
            шума, утечки приёмов и проверки честности — эти режимы есть в симуляторе и в цифрах валидации.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="m-ranking">
          <h2 id="m-ranking">4. Подбор работодателю</h2>
          <p className={styles.soft}>
            Компания сама ищет в базе, разложенной по категориям из теста. Под каждую потребность кандидат получает балл из доказанного, и рядом — обоснование
            словами.
          </p>
          <Weights />
          <div className={styles.links}>
            <Link href="/evaluate">Прогнать ранжирование на своём наборе →</Link>
            <Link href="/validation">Метрики подбора и теста →</Link>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="m-more">
          <h2 id="m-more">Проверить самому</h2>
          <div className={styles.links}>
            <Link href="/simulator">Симулятор теста: один кандидат по шагам</Link>
            <Link href="/validation">Валидация: цифры и команды повтора</Link>
            <Link href="/mechanics">Лаборатория заданий</Link>
          </div>
          {juryLink && <JuryBackLink />}
        </section>
      </Container>
    </main>
  );
}
