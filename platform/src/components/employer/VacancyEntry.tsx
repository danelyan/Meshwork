'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { SPECIALIZATIONS, SPEC_LABEL, type Specialization } from '@/lib/directions';
import { VacancyForm, type CatalogOption, type VacancyFormProps } from './VacancyForm';
import styles from './Employer.module.css';

export function VacancyEntry({ catalog, initial }: { catalog: CatalogOption[]; initial?: VacancyFormProps['initial'] }) {
  const [chosen, setChosen] = useState<Specialization | null>(initial?.specialization ?? null);
  if (chosen) return <div className={styles.form}><div><Button size="sm" onClick={() => setChosen(null)}>← Другие направления</Button></div><VacancyForm key={chosen} catalog={catalog} initial={initial?.specialization === chosen ? initial : { title: '', specialization: chosen, grade: 'junior', salaryFrom: 0, salaryTo: 0, teamDescription: null, description: null, stack: [], needs: catalog.filter((entry) => entry.specialization === chosen).slice(0, 6).map((entry) => ({ catalogId: entry.id, weight: 2 })) }} /></div>;
  return <><div className={styles.templateGrid}>{SPECIALIZATIONS.map((specialization) => <section key={specialization} className={styles.templateCard}><span className={`${styles.status} ${styles.accent}`}>Направление</span><h2>{SPEC_LABEL[specialization]}</h2><p>Выбери уровень, задачи команды и обязательные навыки. Требования возьмём из каталога этого направления.</p><Button variant="cta" onClick={() => setChosen(specialization)}>Начать →</Button></section>)}</div><div className={styles.actions}><Button href="/employer/assistant">Обсудить вакансию с консультантом →</Button></div></>;
}
