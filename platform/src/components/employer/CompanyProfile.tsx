'use client';
import { useState } from 'react';
import { companyDisplayName, companyDisplayDescription } from '@/lib/company-brand';
import { CompanyLogo } from '@/components/landing/CompanyLogo';
import type { CompanyBody } from '@/lib/employer-api';
import { Button } from '@/components/ui';
import { CompanyForm } from './CompanyForm';
import styles from './Employer.module.css';

export function CompanyProfile({ company }: { company: CompanyBody }) {
  const [editing, setEditing] = useState(false);
  return <section className={styles.companyProfile} aria-label="Профиль компании"><div className={styles.explorerBar}><span className={styles.status}>Данные компании</span><Button size="sm" onClick={() => setEditing(!editing)}>{editing ? 'Завершить' : 'Изменить'}</Button></div>{editing ? <CompanyForm company={company} /> : <><div className={styles.identity}><div className={styles.companyMark}><CompanyLogo company={{ name: company.name }} /></div><div><h2>{companyDisplayName(company.name)}</h2><p>{company.industry || 'Отрасль не указана'}</p></div></div><dl className={styles.companyData}><div><dt>О компании</dt><dd>{companyDisplayDescription(company.name, company.description) || 'Добавь описание компании'}</dd></div><div><dt>ИНН</dt><dd>{company.inn || 'Не указан'}</dd></div><div><dt>Контакт</dt><dd>{company.contact || 'Не указан'}</dd></div></dl></>}</section>;
}
