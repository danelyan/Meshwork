import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { GRADE_LABEL, SPEC_LABEL, salaryRange } from '@/components/employer/labels';
import { Button, Kicker, Notice, Panel, Tag } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { listVacancies, loadEmployerContext } from '@/server/employer';

export const metadata: Metadata = { title: 'Кабинет работодателя - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Кабинет работодателя: потребности компании (R-E-02) → подборка (R-E-03). Guard — роль employer. */
export default async function EmployerPage() {
  const s = await requirePageEmployer('/employer');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const vacancies = await listVacancies(ctx.companyId);
  const active = vacancies.filter((v) => !v.archived);
  const archived = vacancies.filter((v) => v.archived);
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Kicker>Кабинет работодателя</Kicker>
          <h1>{ctx.companyName}</h1>
          {ctx.companyDescription && <p className={styles.lead}>{ctx.companyDescription}</p>}
        </div>
        <div className={styles.actions}>
          <Button variant="cta" href="/employer/needs/new">
            Новая потребность
          </Button>
          <Button href="/employer/search">Поиск по всей базе</Button>
        </div>
      </div>
      <section aria-labelledby="needs-h" className={styles.form}>
        <h2 id="needs-h" className={styles.sectionTitle}>
          Потребности ({active.length})
        </h2>
        {active.length === 0 ? (
          <Notice>Потребностей нет. Опиши, кто нужен, - и платформа подберёт кандидатов с обоснованием.</Notice>
        ) : (
          <ul className={`${styles.list} ${styles.grid}`}>
            {active.map((v) => (
              <Panel as="li" key={v.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h3>{v.title}</h3>
                </div>
                <div className={styles.meta}>
                  <Tag tone="solid">
                    {SPEC_LABEL[v.specialization]} · {GRADE_LABEL[v.grade]}
                  </Tag>
                  <span>{salaryRange(v.salaryFrom, v.salaryTo)}</span>
                  <span>требований: {v.needs.length}</span>
                  <span>приглашений: {v.invitations}</span>
                </div>
                {v.teamDescription && <p className={styles.text}>{v.teamDescription}</p>}
                {v.stack.length > 0 && <p className={styles.meta}>Стек: {v.stack.join(', ')}</p>}
                <div className={styles.actions}>
                  <Button variant="primary" size="sm" href={`/employer/needs/${encodeURIComponent(v.id)}`}>
                    Подборка
                  </Button>
                  <Button size="sm" href={`/employer/needs/${encodeURIComponent(v.id)}/edit`}>
                    Изменить
                  </Button>
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </section>
      {archived.length > 0 && (
        <section aria-labelledby="arch-h" className={styles.form}>
          <h2 id="arch-h" className={styles.sectionTitle}>
            Закрытые ({archived.length})
          </h2>
          <ul className={styles.list}>
            {archived.map((v) => (
              <Panel as="li" key={v.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h3>{v.title}</h3>
                  <Button size="sm" href={`/employer/needs/${encodeURIComponent(v.id)}/edit`}>
                    Открыть
                  </Button>
                </div>
              </Panel>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
