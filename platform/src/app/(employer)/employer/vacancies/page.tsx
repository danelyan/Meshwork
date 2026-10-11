import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { VacancyCatalog } from '@/components/employer/VacancyCatalog';
import { Button } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { listVacancies, loadEmployerContext } from '@/server/employer';

export const metadata: Metadata = { title: 'Вакансии - MESHWORK' };
export const dynamic = 'force-dynamic';

export default async function EmployerPage() {
  const s = await requirePageEmployer('/employer/vacancies');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const vacancies = await listVacancies(ctx.companyId);
  return <div className={styles.page}>
    <div className={styles.head}>
      <div><h1>Вакансии<span className={styles.accent}>.</span></h1><p className={styles.lead}>Опиши, кто нужен команде. По ней мы подберём кандидатов с подтверждёнными навыками и покажем, кто закрывает твои требования.</p></div>
      <div className={styles.actions}><Button variant="cta" href="/employer/needs/new">+ Новая вакансия</Button></div>
    </div>
    <VacancyCatalog vacancies={vacancies} />
  </div>;
}
