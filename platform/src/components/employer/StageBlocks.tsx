import type { Explanation } from '@/server/employer/ranking';
import { projectFlagLabel } from '@/server/employer/stages';

import { Tag } from '../ui';

import styles from './Employer.module.css';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const OWNERSHIP_TEXT = { explained: 'объяснил сам', partial: 'объяснил частично', failed: 'не смог объяснить', not_checked: 'не проверялось' } as const;
const PASS = (v: boolean | null) => (v === null ? 'не проверялось' : v ? 'прошёл' : 'не прошёл');

/** «Созвон: карта глубины» (ступень 1): тема → подтверждено/нет. Цитат нет по построению данных. */
export function DepthMapBlock({ depth }: { depth: NonNullable<Explanation['depthMap']> }) {
  return (
    <section className={styles.stage} aria-label="Созвон: карта глубины">
      <h4 className={styles.stageTitle}>Созвон: карта глубины</h4>
      <p className={styles.meta}>
        Подтверждено {depth.confirmed} из {depth.topics.length} тем
        {depth.matchedNeed > 0 && `, из них требований вакансии - ${depth.matchedNeed}`}.
      </p>
      {depth.testOwnership && (
        <p className={styles.meta} data-testid="test-ownership">
          Решения теста: {OWNERSHIP_TEXT[depth.testOwnership]}. Сигнал, в оценку не входит.
        </p>
      )}
      <ul className={styles.why}>
        {depth.topics.map((t) => (
          <li key={t.topic}>
            <b>{t.topic}</b> - {t.confirmed ? 'подтверждено' : t.probed > 0 ? 'не подтверждено' : 'не спрашивали'}
            {t.probed > 0 && <span className={styles.meta}> · оценка {t.total} из 8</span>}
            {t.forNeed && (
              <>
                {' '}
                <Tag tone="outline">требование вакансии</Tag>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Проект: критерий → прошёл/нет → доказательство». Под эту потребность - вся таблица; под чужую - только факт
 * «есть проверенный проект в подкатегории X, балл Y» (без критериев и без вакансии).
 */
export function ProjectBlock({ project }: { project: NonNullable<Explanation['project']> }) {
  const own = project.own;
  return (
    <section className={styles.stage} aria-label="Проект">
      <h4 className={styles.stageTitle}>Проект</h4>
      {own && (
        <>
          <p className={styles.text}>
            Под эту вакансию: скрытые тесты {own.tests.passed} из {own.tests.total} ({pct(own.score)})
            {own.late && ', сдано после срока'}.
          </p>
          {own.flags.length > 0 && (
            <p className={styles.note}>Флаги проверки: {own.flags.map(projectFlagLabel).join('; ')}.</p>
          )}
          {own.criteria.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Критерии проекта">
                <thead>
                  <tr>
                    <th scope="col">Критерий</th>
                    <th scope="col">Результат</th>
                    <th scope="col">Доказательство</th>
                  </tr>
                </thead>
                <tbody>
                  {own.criteria.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.text} <span className={styles.meta}>({c.source === 'required' ? 'обязательный' : 'пожелание'})</span>
                      </td>
                      <td>{PASS(c.passed)}</td>
                      <td>
                        {c.evidence || '-'}
                        {c.file ? <span className={styles.meta}> · {c.file}</span> : null}
                        {c.flag ? <span className={styles.meta}> · {projectFlagLabel(c.flag)}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.meta}>Пояснения к критериям - от ИИ-проверки по рубрике, в балл не входят; балл - доля пройденных скрытых тестов.</p>
        </>
      )}
      {project.others.length > 0 && (
        <ul className={styles.why} aria-label="Проекты по другим вакансиям">
          {project.others.map((o, i) => (
            <li key={`${o.subcategoryId ?? 'none'}-${i}`}>
              Есть проверенный проект в подкатегории {o.subcategory}, балл {pct(o.score)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** «Защита»: балл по рубрике A-02 и флаги. Флаг - пометка для разговора, не штраф. */
export function DefenseBlock({ defense }: { defense: NonNullable<Explanation['defense']> }) {
  return (
    <section className={styles.stage} aria-label="Защита">
      <h4 className={styles.stageTitle}>Защита проекта</h4>
      <p className={styles.text}>
        {defense.score === null
          ? 'Оценки нет: кандидат не ответил ни на один вопрос.'
          : `Балл по рубрике A-02: ${defense.score} из 8 - ${defense.passed ? 'понимание своего кода показано' : 'ниже порога'}.`}
      </p>
      {defense.notes.map((n, i) => (
        <p key={defense.flags[i] ?? i} className={styles.note} data-flag={defense.flags[i]}>
          {n}
        </p>
      ))}
    </section>
  );
}
