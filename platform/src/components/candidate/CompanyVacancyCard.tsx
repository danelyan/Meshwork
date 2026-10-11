import Link from 'next/link';

import { chooseGapCta, type GapCategory } from '@/lib/career-gap';
import { specLabel } from '@/lib/directions';
import { GRADE_LABEL, isGrade } from '@/lib/grades';
import { LEVEL_LABEL, isLevel } from '@/lib/labels';
import type { CareerVacancy } from '@/server/recommend/career';

import { Button, Kicker, Notice, Panel, Tag } from '../ui';
import { ApplyPanel } from './ApplyPanel';
import styles from './Candidate.module.css';
import own from './CompanyVacancyCard.module.css';

const money = new Intl.NumberFormat('ru-RU');

/** Полная карточка вакансии под кандидата: описание, команда, стек, соответствие и действия (та же логика, что на /career). */
export function CompanyVacancyCard({ vacancy, categories }: { vacancy: CareerVacancy; categories: GapCategory[] }) {
  const k = vacancy.matched.length;
  const n = vacancy.matched.length + vacancy.missing.length;
  const cta = chooseGapCta(vacancy, categories);
  return <Panel className={`${styles.card} ${own.card}`} aria-label={vacancy.title}>
    <div className={own.head}>
      <h2>{vacancy.title}</h2>
      <div className={own.tags}>
        <Tag>{specLabel(vacancy.specialization)} × {isGrade(vacancy.grade) ? GRADE_LABEL[vacancy.grade] : vacancy.grade}</Tag>
        <Tag>{money.format(vacancy.salaryFrom)} – {money.format(vacancy.salaryTo)} ₽</Tag>
      </div>
    </div>
    {vacancy.description && <div className={own.block}>{vacancy.description.split('\n').filter((l) => l.trim()).map((l, i) => <p key={i}>{l}</p>)}</div>}
    {vacancy.teamDescription && <div className={own.block}><h3>Команда</h3><p>{vacancy.teamDescription}</p></div>}
    {vacancy.stack.length > 0 && <div className={own.block}><h3>Стек</h3><div className={own.tags}>{vacancy.stack.map((s) => <Tag key={s}>{s}</Tag>)}</div></div>}
    <div className={own.fit}>
      <Kicker>Твоё соответствие</Kicker>
      <strong>{n > 0 ? `Закрываешь ${k} из ${n} требований` : 'Требования не заданы'}</strong>
      {k > 0 && <ul className={styles.requirements}>{vacancy.matched.map((m) => <li key={m.catalogId}>✓ {m.statement}<small className={styles.meta}> · {isLevel(m.level) ? LEVEL_LABEL[m.level] : 'со слов'}</small></li>)}</ul>}
      {vacancy.missing.length > 0 && <ul className={`${styles.requirements} ${own.lack}`} aria-label="Не хватает">{vacancy.missing.map((m) => <li key={m.catalogId}>○ {m.statement}</li>)}</ul>}
    </div>
    <div className={own.actions}>
      {cta.href ? <Button href={cta.href}>{cta.label === 'Пройти тест' ? cta.label : `Что подтянуть: ${cta.label.toLowerCase()}`}</Button> : <Notice>{cta.label}</Notice>}
      <p className={styles.fine}>{cta.hint}</p>
      <ApplyPanel vacancyId={vacancy.vacancyId} companyName={vacancy.companyName} />
      <Link className={own.mapLink} href={`/career?vacancy=${encodeURIComponent(vacancy.vacancyId)}`}>Открыть на карте соответствия</Link>
    </div>
  </Panel>;
}
