import type { Metadata } from 'next';

import { CompanyForm } from '@/components/employer/CompanyForm';
import styles from '@/components/employer/Employer.module.css';
import { Button, Kicker } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { getCompany } from '@/server/employer/company';
import { loadEmployerContext } from '@/server/employer/context';

export const metadata: Metadata = { title: 'Профиль компании - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Профиль компании работодателя (R-E-01): просмотр и правка. Guard - роль employer. */
export default async function EmployerCompanyPage() {
  const s = await requirePageEmployer('/employer/company');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const { name, description, industry, inn, contact } = await getCompany(ctx.companyId);
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Kicker>Кабинет работодателя</Kicker>
          <h1>Профиль компании</h1>
          <p className={styles.lead}>Эти данные видят кандидаты в приглашении. Чем полнее профиль, тем охотнее откликаются.</p>
        </div>
        <div className={styles.actions}>
          <Button href="/employer">К потребностям</Button>
        </div>
      </div>
      <CompanyForm company={{ name, description, industry, inn, contact }} />
    </div>
  );
}
