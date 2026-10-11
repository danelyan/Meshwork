'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Chip } from '@/components/ui';

import styles from './HiringShowcase.module.css';

const SPECIALIZATIONS = ['Backend', 'Frontend', 'Mobile', 'Data / ML', 'DevOps', 'QA'] as const;
const GRADES = ['Junior', 'Middle', 'Senior'] as const;
type Specialization = typeof SPECIALIZATIONS[number];
type Grade = typeof GRADES[number];

/** Fictional data from Karina's export, not live vacancies or matching results. */
export const DEMO_HIRING_COMPANIES: readonly {
  id: string; name: string; focus: string; description: string; vacancies: number;
  specializations: readonly Specialization[]; grades: readonly Grade[]; minimum: number; maximum: number;
}[] = [
  { id: 'sc-1', name: 'Аврора Лабс', focus: 'Backend · Middle, Senior', description: 'Облачная платформа для логистики', vacancies: 4, specializations: ['Backend'], grades: ['Middle', 'Senior'], minimum: 280, maximum: 420 },
  { id: 'sc-2', name: 'Кедр', focus: 'Frontend · Junior, Middle', description: 'Сервис электронных очередей', vacancies: 3, specializations: ['Frontend'], grades: ['Junior', 'Middle'], minimum: 140, maximum: 260 },
  { id: 'sc-3', name: 'Полюс Системс', focus: 'Backend, Data · Middle', description: 'Аналитика для промышленности', vacancies: 5, specializations: ['Backend', 'Data / ML'], grades: ['Middle'], minimum: 240, maximum: 380 },
  { id: 'sc-4', name: 'Вектор Пэй', focus: 'Backend · Junior, Middle', description: 'Платёжный шлюз для малого бизнеса', vacancies: 2, specializations: ['Backend'], grades: ['Junior', 'Middle'], minimum: 150, maximum: 300 },
  { id: 'sc-5', name: 'Маяк Мобайл', focus: 'Mobile · Middle, Senior', description: 'Приложения для ритейла', vacancies: 3, specializations: ['Mobile'], grades: ['Middle', 'Senior'], minimum: 260, maximum: 400 },
  { id: 'sc-6', name: 'Тундра Тех', focus: 'DevOps · Middle', description: 'Инфраструктура и мониторинг', vacancies: 2, specializations: ['DevOps'], grades: ['Middle'], minimum: 250, maximum: 350 },
  { id: 'sc-7', name: 'Ладога Софт', focus: 'Frontend, Backend · Junior', description: 'Образовательная платформа', vacancies: 4, specializations: ['Frontend', 'Backend'], grades: ['Junior'], minimum: 100, maximum: 180 },
  { id: 'sc-8', name: 'Квант Ривер', focus: 'ML, Backend · Senior', description: 'Рекомендательные системы', vacancies: 2, specializations: ['Data / ML', 'Backend'], grades: ['Senior'], minimum: 380, maximum: 480 },
  { id: 'sc-9', name: 'Бирюза', focus: 'QA, Backend · Junior, Middle', description: 'Маркетплейс услуг', vacancies: 3, specializations: ['QA', 'Backend'], grades: ['Junior', 'Middle'], minimum: 120, maximum: 240 },
];

export function getDemoHiringMatch(specialization: Specialization, grade: Grade) {
  const companies = DEMO_HIRING_COMPANIES.filter(company => company.specializations.includes(specialization) && company.grades.includes(grade));
  return {
    companies,
    count: companies.length,
    minimum: companies.length ? Math.min(...companies.map(company => company.minimum)) : 0,
    maximum: companies.length ? Math.max(...companies.map(company => company.maximum)) : 0,
  };
}

function plural(count: number, forms: readonly [string, string, string]) {
  const last = count % 10;
  return count % 100 >= 11 && count % 100 <= 14 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
}

function AnimatedCount({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !window.requestAnimationFrame) {
      last.current = value;
      setShown(value);
      return;
    }
    const from = last.current;
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min((now - start) / 420, 1);
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
      last.current = next;
      setShown(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <b className={styles.count} aria-hidden="true">{shown}</b>;
}

export function HiringShowcase({ signedIn }: { signedIn: boolean }) {
  const [specialization, setSpecialization] = useState<Specialization>('Backend');
  const [grade, setGrade] = useState<Grade>('Middle');
  const match = getDemoHiringMatch(specialization, grade);
  const destination = signedIn ? '/consultant' : '/auth?next=%2Fconsultant';
  const label = `${match.count} ${plural(match.count, ['компания', 'компании', 'компаний'])} ${match.count === 1 ? 'ищет' : 'ищут'} ${specialization} ${grade}`;
  const pay = match.count ? `${match.minimum}-${match.maximum}k ₽ / мес.` : 'Пока нет совпадений';

  return (
    <section id="companies" className={styles.section} aria-labelledby="hiring-title">
      <div className={styles.header}>
        <div>
          <h2 id="hiring-title" className={styles.title}>Сейчас нанимают<span>.</span></h2>
          <p className={styles.description}>Выбери направление и уровень - подсветим компании, которые ищут именно тебя.</p>
          <div className={styles.filters} role="group" aria-label="Направление">
            {SPECIALIZATIONS.map(item => <Chip key={item} pressed={specialization === item} className={styles.filter} onClick={() => setSpecialization(item)}>{item}</Chip>)}
          </div>
          <div className={styles.grades} role="group" aria-label="Уровень">
            {GRADES.map(item => <Chip key={item} pressed={grade === item} className={styles.grade} onClick={() => setGrade(item)}>{item}</Chip>)}
          </div>
        </div>
        <div className={styles.summary}>
          <AnimatedCount value={match.count} />
          <span className={styles.summaryLabel} role="status">{label}</span>
          <span className={styles.salary}>
            <span className={styles.pay}><span>вилка</span><b>{pay}</b></span>
            <span className={styles.meter} aria-hidden="true"><i style={{ left: `${match.count ? match.minimum / 5 : 0}%`, width: `${match.count ? (match.maximum - match.minimum) / 5 : 0}%` }} /></span>
          </span>
        </div>
      </div>
      <p className={styles.demo}>Демо-подборка · вымышленные компании и вакансии</p>
      <div className={styles.rail}>
        <div className={styles.track}>
          {[0, 1].map(copy => <div key={copy} className={styles.group} aria-hidden={copy === 1 ? true : undefined}>
            {DEMO_HIRING_COMPANIES.map((company, index) => {
              const matches = match.companies.some(item => item.id === company.id);
              return <div key={company.id} className={styles.tile} style={{ animationDelay: `${index % 4 * -2.5}s`, animationDuration: `${9.5 + index % 4 * 1.5}s` }}>
                <Link href={destination} tabIndex={copy === 1 ? -1 : undefined} className={`${styles.company} ${matches ? styles.matched : ''}`} data-match={matches}>
                  <span className={styles.cardTop}><span className={styles.letter}>{company.name.charAt(0)}</span>{matches && <em className={styles.badge}>ищет тебя</em>}</span>
                  <b className={styles.name}>{company.name}</b>
                  <small className={styles.focus}>{company.focus}<br />{company.description}</small>
                  <span className={styles.cardBottom}><span>{company.vacancies} {plural(company.vacancies, ['вакансия', 'вакансии', 'вакансий'])}</span><em>до {company.maximum}k</em></span>
                </Link>
              </div>;
            })}
          </div>)}
        </div>
      </div>
    </section>
  );
}
