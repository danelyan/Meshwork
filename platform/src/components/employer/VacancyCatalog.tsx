'use client';

import { useState } from 'react';
import type { VacancyView } from '@/server/employer/vacancies';
import { Button, Notice, Panel, Tag } from '@/components/ui';
import { GRADE_LABEL, SPEC_LABEL, salaryRange } from './labels';
import styles from './Employer.module.css';

export function VacancyCatalog({ vacancies }: { vacancies: VacancyView[] }) {
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const visible = vacancies.filter((v) => filter === 'all' || v.archived === (filter === 'archived'));
  const filters = [{ id: 'active', label: 'Активные', count: vacancies.filter((v) => !v.archived).length }, { id: 'archived', label: 'Закрытые', count: vacancies.filter((v) => v.archived).length }, { id: 'all', label: 'Все', count: vacancies.length }] as const;
  return <section className={styles.form} aria-label="Вакансии компании">
    <div className={styles.tabs} aria-label="Статус вакансии">{filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}</div>
    {visible.length === 0 ? <Notice>Здесь пока нет вакансий. Создай потребность команды, чтобы получить подборку кандидатов.</Notice> :
      <ul className={`${styles.list} ${styles.grid}`}>{visible.map((v) => <Panel as="li" key={v.id} className={`${styles.card} ${styles.vacancyCard}`}>
        <div className={styles.cardHead}><h2>{v.title}</h2><Tag tone={v.archived ? 'dashed' : 'solid'}>{v.archived ? 'Закрыта' : 'Активна'}</Tag></div>
        <p className={styles.meta}>{SPEC_LABEL[v.specialization]} · {GRADE_LABEL[v.grade]}</p>
        <strong className={styles.salary}>{salaryRange(v.salaryFrom, v.salaryTo)}</strong>
        {v.teamDescription && <p className={styles.text}>{v.teamDescription}</p>}
        <div className={styles.chips}>{v.stack.map((skill) => <Tag key={skill}>{skill}</Tag>)}</div>
        <p className={styles.meta}>Требований: {v.needs.length} · приглашений: {v.invitations}</p>
        <div className={styles.vacancyActions}><Button variant="primary" size="sm" href={`/employer/needs/${encodeURIComponent(v.id)}`}>Подборка →</Button><Button size="sm" href={`/employer/needs/${encodeURIComponent(v.id)}/edit`}>{v.archived ? 'Открыть вакансию' : 'Изменить'}</Button></div>
      </Panel>)}</ul>}
  </section>;
}
