'use client';
import { useState } from 'react';
import type { VacancyView } from '@/server/employer/vacancies';
import { Button, Notice, Panel, Tag } from '@/components/ui';
import { SPECIALIZATIONS } from '@/lib/directions';
import { GRADE_LABEL, SPEC_LABEL, salaryRange } from './labels';
import styles from './Employer.module.css';

export function VacancyCatalog({ vacancies }: { vacancies: VacancyView[] }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const visible = vacancies.filter((v) => (filter === 'all' || (filter === 'archived' ? v.archived : v.specialization === filter)) && `${v.title} ${v.stack.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const filters = [{ id: 'all', label: 'Все' }, ...SPECIALIZATIONS.map((specialization) => ({ id: specialization, label: SPEC_LABEL[specialization] })), { id: 'archived', label: 'Закрытые' }];
  return <section className={styles.form} aria-label="Вакансии компании">
    <div className={styles.catalogToolbar}><input aria-label="Поиск вакансий" placeholder="Название или стек" value={query} onChange={(event) => setQuery(event.target.value)} /><div className={styles.tabs} aria-label="Статус вакансии">{filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></div>
    {visible.length === 0 ? <Notice>Вакансий по этим условиям нет. Измени фильтр или создай новую вакансию.</Notice> : <ul className={`${styles.list} ${styles.grid}`}>{visible.map((v) => <Panel as="li" key={v.id} className={`${styles.card} ${styles.vacancyCard}`}><div className={styles.cardHead}><h2>{v.title}</h2><Tag tone={v.archived ? 'dashed' : 'solid'}>{v.archived ? 'Закрыта' : 'Активна'}</Tag></div><p className={styles.meta}>{SPEC_LABEL[v.specialization]} · {GRADE_LABEL[v.grade]}</p><strong className={styles.salary}>{salaryRange(v.salaryFrom, v.salaryTo)}</strong>{v.teamDescription && <p className={styles.text}>{v.teamDescription}</p>}<div className={styles.chips}>{v.stack.map((skill) => <Tag key={skill}>{skill}</Tag>)}</div><p className={styles.meta}>Требований: {v.needs.length} · приглашений: {v.invitations}</p><div className={styles.vacancyActions}><Button size="sm" href={`/employer/needs/${encodeURIComponent(v.id)}`}>Подборка →</Button><Button size="sm" variant="ghost" href={`/employer/needs/${encodeURIComponent(v.id)}/edit`}>Изменить</Button></div></Panel>)}</ul>}
  </section>;
}
