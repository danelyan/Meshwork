import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { VacancyCatalog } from '@/components/employer/VacancyCatalog';
import { Button, Kicker } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { listVacancies, loadEmployerContext } from '@/server/employer';

export const metadata: Metadata = { title: 'Вакансии - ФСП Карьера' };
export const dynamic = 'force-dynamic';

export default async function EmployerPage() {
  const s = await requirePageEmployer('/employer');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const vacancies = await listVacancies(ctx.companyId);
  return <div className={styles.page}>
    <div className={styles.head}>
      <div><Kicker>{ctx.companyName}</Kicker><h1>Вакансии.</h1><p className={styles.lead}>Опиши потребность команды. По ней мы подберём кандидатов с подтверждёнными навыками и покажем, кто закрывает твои требования.</p></div>
      <div className={styles.actions}><Button variant="cta" href="/employer/assistant">+ Вакансия с консультантом</Button><Button href="/employer/needs/new">Заполнить вручную</Button></div>
    </div>
    <VacancyCatalog vacancies={vacancies} />
  </div>;
}
