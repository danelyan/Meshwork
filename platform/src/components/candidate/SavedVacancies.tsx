'use client';

import type { CareerVacancy } from '@/server/recommend/career';
import { Button, Notice } from '../ui';
import styles from './Candidate.module.css';
const money = new Intl.NumberFormat('ru-RU');
const coveragePercent = (vacancy: CareerVacancy) => vacancy.total > 0 ? Math.round(Math.min(1, vacancy.covered / vacancy.total) * 100) : 0;

export function SavedVacancies({ vacancies, saving, error, onRemove }: { vacancies: CareerVacancy[]; saving: boolean; error: string | null; onRemove: (id: string) => void }) {
  return <div className={styles.page}>
    <header className={styles.heading}><h1>Избранное<i>.</i></h1><p>Вакансии, к которым хотите вернуться с любого устройства. Компаниям сохранение не открывает ваши имя и контакт.</p></header>
    {error && <Notice tone="error">{error}</Notice>}
    <span className={styles.meta} role="status">Вакансий: {vacancies.length}</span>
    {vacancies.length ? <div className={styles.savedGrid}>{vacancies.map((vacancy) => <article key={vacancy.vacancyId} className={styles.savedCard}><div><span className={styles.savedLetter}>{vacancy.companyName.slice(0, 1)}</span><div><h2>{vacancy.companyName}</h2><p>{vacancy.title}</p></div><strong>{coveragePercent(vacancy)}%</strong></div><small>Вилка {money.format(vacancy.salaryFrom)} - {money.format(vacancy.salaryTo)} ₽</small><footer><Button href={`/career?vacancy=${encodeURIComponent(vacancy.vacancyId)}`}>На карте →</Button><Button className={styles.savedRemove} aria-label={`Убрать из избранного: ${vacancy.companyName}`} disabled={saving} onClick={() => onRemove(vacancy.vacancyId)}>★</Button></footer></article>)}</div> : <div className={styles.savedEmpty}>Пока пусто. Сохраняйте вакансии кнопкой ☆ в панели справа на карте.<Button href="/career">Перейти на карту →</Button></div>}
  </div>;
}
