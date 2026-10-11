import Link from 'next/link';

import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Panel, Tag } from '@/components/ui';
import { GRADES, GRADE_LABEL } from '@/lib/grades';
import { SPECIALIZATIONS, SPEC_LABEL, type Specialization } from '@/lib/directions';
import { LEAK_FIGURES } from '@/server/mechanics/leak-figures';
import type { BankTotals, FamilyItem, LabFamily } from '@/server/mechanics/lab';

import styles from './Mechanics.module.css';

export interface MechanicsData {
  totals: BankTotals;
  spec: Specialization;
  subcategories: { id: string; title: string; families: number }[];
  subcategoryId: string | null;
  families: FamilyItem[];
  family: LabFamily | null;
  seed: number;
}

const nf = new Intl.NumberFormat('ru-RU');
const num = (x: number) => String(x).replace('.', ',');

function href(q: { spec: Specialization; sub?: string | null; family?: string | null; seed?: number }): string {
  const p = new URLSearchParams({ spec: q.spec });
  if (q.sub) p.set('sub', q.sub);
  if (q.family) p.set('family', q.family);
  if (q.seed !== undefined) p.set('seed', String(q.seed));
  return `/mechanics?${p.toString()}`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/** Публичная «Лаборатория вариантов»: выбор семейства, три варианта из разных seed, параметры IRT, довод про утечку. */
export function MechanicsView({ data }: { data: MechanicsData }) {
  const { totals, spec, subcategories, subcategoryId, families, family, seed } = data;
  const q = { spec, sub: subcategoryId };
  return (
    <Container size="wide" className={styles.page}>
      <PageTitle
        kicker="Механика теста"
        title="Лаборатория вариантов заданий"
        lead="Задание – не фиксированный вопрос, а семейство-генератор. Один seed даёт один вариант, ключ считает код, не нейросеть. Выберите семейство и сравните варианты."
      />

      <Panel as="section" className={styles.section} aria-labelledby="pick">
        <h2 id="pick">Выбор семейства</h2>
        <nav className={styles.row} aria-label="Направление">
          {SPECIALIZATIONS.map((s) => (
            <Link key={s} className={styles.pick} aria-current={s === spec} href={href({ spec: s })}>
              {SPEC_LABEL[s]}
            </Link>
          ))}
        </nav>
        <nav className={styles.row} aria-label="Подкатегория">
          {subcategories.map((s) => (
            <Link key={s.id} className={styles.pick} aria-current={s.id === subcategoryId} href={href({ spec, sub: s.id })}>
              {s.title} ({s.families})
            </Link>
          ))}
        </nav>
        {families.length === 0 ? (
          <p className={styles.soft}>У этой подкатегории семейств пока нет.</p>
        ) : (
          <div className={styles.grades}>
            {GRADES.map((g) => (
              <div key={g} className={styles.section}>
                <h3>{GRADE_LABEL[g]}</h3>
                <div className={styles.row}>
                  {families
                    .filter((f) => f.grade === g)
                    .map((f) => (
                      <Link key={f.id} className={styles.pick} aria-current={f.id === family?.id} href={href({ ...q, family: f.id })}>
                        {f.title}
                        {f.shared ? ' (общее)' : ''}
                      </Link>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {family && (
        <Panel as="section" className={styles.section} aria-labelledby="variants">
          <h2 id="variants">{family.title}</h2>
          <div className={styles.row}>
            <Tag>{family.irt.gradeLabel}</Tag>
            <Tag tone="outline">ответ: {family.irt.formatLabel}</Tag>
            <Tag tone="outline">лимит {family.irt.timeLimitSec} с</Tag>
            <Button href={href({ ...q, family: family.id, seed: seed + 1 })} size="sm">
              Другой seed
            </Button>
          </div>
          <div className={styles.stats}>
            <Stat value={num(family.irt.a)} label="a: различающая способность (экспертная оценка)" />
            <Stat value={num(family.irt.b)} label="b: трудность на шкале θ (экспертная оценка)" />
            <Stat value={nf.format(family.irt.paramSpace)} label="экземпляров в семействе (порядок)" />
          </div>
          <p className={styles.soft}>
            Параметры a и b – стартовые экспертные, на людях не откалиброваны. Семейство: <span className={styles.mono}>{family.id}</span>.
          </p>
          <div className={styles.variants}>
            {family.variants.map((v, i) => (
              <article key={v.seed} className={styles.variant} aria-label={`Вариант ${i + 1}`}>
                <h3>Вариант {i + 1}</h3>
                <span className={styles.soft}>
                  seed <span className={styles.mono}>{v.seed}</span>
                </span>
                <p className={styles.prompt}>{v.prompt}</p>
                {v.code && <pre className={styles.code}>{v.code}</pre>}
                <span className={styles.soft}>Ответ: {v.answerHint}</span>
                <details className={styles.details}>
                  <summary>Показать ключ</summary>
                  <div className={styles.key}>
                    <span>
                      Ключ: <span className={styles.mono}>{v.answerKey}</span>
                    </span>
                    <span className={styles.soft}>{v.explanation}</span>
                  </div>
                </details>
                {v.diff.length > 0 && (
                  <div>
                    <span className={styles.soft}>Отличается параметрами:</span>
                    <ul className={styles.list}>
                      {v.diff.map((d) => (
                        <li key={d.name}>
                          <span className={styles.mono}>
                            {d.name} = {d.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
          {family.strippedLines > 0 && <p className={styles.soft}>Из вывода убрано служебных строк защиты: {family.strippedLines}. Их содержимое не публикуется.</p>}
        </Panel>
      )}

      <Panel as="section" className={styles.section} aria-labelledby="leak">
        <h2 id="leak">Почему утечка не помогает</h2>
        {family && (
          <p>
            Проверка на этом семействе: из {family.probe.samples} случайных экземпляров {family.probe.distinctKeys} разных ключей; ключ утёкшего экземпляра совпадёт с ключом другого с вероятностью{' '}
            {(family.probe.keyCollision * 100).toFixed(1).replace('.', ',')} %.
          </p>
        )}
        <ul className={styles.list}>
          {LEAK_FIGURES.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className={styles.soft}>Источник: {LEAK_FIGURES.doc}.</p>
        <div className={styles.row}>
          <Button href="/validation" size="sm">
            Полные цифры валидации
          </Button>
        </div>
      </Panel>

      <Panel as="section" className={styles.section} aria-labelledby="total">
        <h2 id="total">Сколько всего</h2>
        <div className={styles.stats}>
          <Stat value={String(totals.total)} label="семейств в банке" />
          {GRADES.map((g) => (
            <Stat key={g} value={String(totals.perGrade[g])} label={`грейд ${GRADE_LABEL[g]}`} />
          ))}
          <Stat value={String(totals.shared)} label="общих семейств" />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Направление</th>
                <th className={styles.num}>Всего</th>
                {GRADES.map((g) => (
                  <th key={g} className={styles.num}>
                    {GRADE_LABEL[g]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals.perSpec.map((r) => (
                <tr key={r.spec}>
                  <td>{r.label}</td>
                  <td className={styles.num}>{r.own}</td>
                  {GRADES.map((g) => (
                    <td key={g} className={styles.num}>
                      {r.perGrade[g]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.soft}>
          Размер пространства экземпляров на семейство: от {nf.format(totals.paramSpace.min)} до {nf.format(totals.paramSpace.max)}. Общие семейства считаются отдельно и входят в пул нескольких подкатегорий.
        </p>
      </Panel>
    </Container>
  );
}
