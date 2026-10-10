'use client';
import { useState } from 'react';
import type { VacancyView } from '@/server/employer/vacancies';
import { Button } from '@/components/ui';
import { GRADE_LABEL, SPEC_LABEL, salaryRange } from './labels';
import styles from './Employer.module.css';

export function VacancySwitcher({ vacancies, currentId }: { vacancies: VacancyView[]; currentId: string }) {
  const [query, setQuery] = useState('');
  const current = vacancies.findIndex((vacancy) => vacancy.id === currentId);
  const selected = vacancies[current];
  if (!selected) return null;
  const previous = vacancies[(current - 1 + vacancies.length) % vacancies.length]!;
  const next = vacancies[(current + 1) % vacancies.length]!;
  const visible = vacancies.filter((v) => `${v.title} ${v.stack.join(' ')} ${GRADE_LABEL[v.grade]}`.toLowerCase().includes(query.toLowerCase()));
  return <nav className={styles.vacancySwitcher} aria-label="Выбор вакансии для подборки"><Button href={`/employer/needs/${encodeURIComponent(previous.id)}`} aria-label="Предыдущая вакансия">‹</Button><details className={styles.vacancyPicker}><summary><span className={styles.status}>Вакансия {current + 1} из {vacancies.length}</span><strong>{selected.title}<span aria-hidden="true">⌄</span></strong><small>{SPEC_LABEL[selected.specialization]} · {GRADE_LABEL[selected.grade]} · {salaryRange(selected.salaryFrom, selected.salaryTo)}</small></summary><div className={styles.vacancyOptions}><div className={styles.searchInput}><input aria-label="Найти вакансию" placeholder="Название, стек или грейд" value={query} onChange={(event) => setQuery(event.target.value)} /></div>{visible.map((v) => <Button key={v.id} href={`/employer/needs/${encodeURIComponent(v.id)}`} aria-current={v.id === currentId ? 'page' : undefined}>{v.title} · {GRADE_LABEL[v.grade]}</Button>)}{!visible.length && <p>Вакансий не найдено</p>}<Button href="/employer/needs/new">+ Новая вакансия</Button></div></details><Button href={`/employer/needs/${encodeURIComponent(next.id)}`} aria-label="Следующая вакансия">›</Button></nav>;
}
