import type { Metadata } from 'next';

import { CompanyForm } from '@/components/employer/CompanyForm';
import { AccountErasure } from '@/components/auth/AccountErasure';
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
          <h1>Компания.</h1>
          <p className={styles.lead}>Эти данные видят кандидаты в приглашении. Чем полнее профиль, тем охотнее откликаются.</p>
        </div>
        <div className={styles.actions}>
          <Button href="/employer">К потребностям</Button>
        </div>
      </div>
      <div className={styles.companyColumns}>
        <CompanyForm company={{ name, description, industry, inn, contact }} />
        <aside className={styles.companyPreview} aria-label="Компания в приглашении">
          <Kicker>Так компанию увидит кандидат</Kicker>
          <div className={styles.companyMark} aria-hidden="true">{name.slice(0, 1)}</div>
          <h2>{name}</h2>
          {industry && <p className={styles.meta}>{industry}</p>}
          <p className={styles.text}>{description || 'Добавь описание компании: чем занимается команда и какой продукт создаёт.'}</p>
          <div className={styles.contacts}><strong>Связь с компанией</strong><span>{contact || 'Укажи контакт в профиле компании'}</span></div>
          <p className={styles.meta}>Название, описание и контакт открыты кандидату до принятия приглашения. Зарплата и условия задаются отдельно для каждого предложения.</p>
        </aside>
      </div>
      <AccountErasure />
    </div>
  );
}
