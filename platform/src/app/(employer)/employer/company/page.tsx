import type { Metadata } from 'next';

import { CompanyProfile } from '@/components/employer/CompanyProfile';
import { AccountErasure } from '@/components/auth/AccountErasure';
import { ConsentsPanel } from '@/components/consent/ConsentsPanel';
import styles from '@/components/employer/Employer.module.css';
import { Button } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { getCompany } from '@/server/employer/company';
import { loadEmployerContext } from '@/server/employer/context';
import { listVacancies } from '@/server/employer/vacancies';
import { salaryRange } from '@/components/employer/labels';

export const metadata: Metadata = { title: 'Профиль компании - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Профиль компании работодателя (R-E-01): просмотр и правка. Guard - роль employer. */
export default async function EmployerCompanyPage() {
  const s = await requirePageEmployer('/employer/company');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const { name, description, industry, inn, contact } = await getCompany(ctx.companyId);
  const vacancy = (await listVacancies(ctx.companyId)).find((item) => !item.archived);
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>

          <h1>Компания<span className={styles.accent}>.</span></h1>
          <p className={styles.lead}>Эти данные видят кандидаты в приглашении. Чем полнее профиль, тем охотнее откликаются.</p>
        </div>
        <div className={styles.actions}>
          <Button href="/employer">К вакансиям</Button>
        </div>
      </div>
      <div className={styles.companyColumns}>
        <CompanyProfile company={{ name, description, industry, inn, contact }} />
        <aside className={styles.companyPreview} aria-label="Компания в приглашении">

          <span className={styles.status}>Так видит кандидат</span>
          <div className={styles.previewInvitation}><div className={styles.identity}><div className={styles.companyMark} aria-hidden="true">{name.slice(0, 1)}</div><div><h2>{name}</h2>{industry && <p>{industry}</p>}</div></div>{vacancy ? <><h3>{vacancy.title}</h3><strong className={styles.salary}>{salaryRange(vacancy.salaryFrom, vacancy.salaryTo)}</strong><p className={styles.note}>{vacancy.teamDescription || description || 'Описание команды ещё не добавлено'}</p></> : <p className={styles.text}>Создай вакансию, чтобы увидеть здесь предложение с зарплатой.</p>}<p className={styles.meta}>{contact || 'Укажи контакт в профиле компании'}</p></div>
          <p className={styles.meta}>Предпросмотр по активной вакансии. Личное сообщение и вилка уточняются перед отправкой.</p>
        </aside>
      </div>
      <ConsentsPanel />
      <AccountErasure />
    </div>
  );
}
