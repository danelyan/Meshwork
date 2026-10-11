import type { Metadata } from 'next';
import { Button } from '@/components/ui';
import styles from '@/components/employer/Employer.module.css';
import { requirePageEmployer } from '@/server/auth/page';
import { listVacancies, loadEmployerContext } from '@/server/employer';
import NeedMatchesPage from './needs/[id]/page';

export const metadata: Metadata = { title: 'Подборка - MESHWORK' };
export const dynamic = 'force-dynamic';

export default async function EmployerPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const session = await requirePageEmployer('/employer');
  const context = await loadEmployerContext(session.employerProfileId);
  const vacancies = await listVacancies(context.companyId);
  const first = vacancies.find((vacancy) => !vacancy.archived);
  if (first) return NeedMatchesPage({ params: Promise.resolve({ id: first.id }), searchParams });
  return <div className={styles.page}><div className={styles.head}><div><h1>Подборка<br />под вакансию<span className={styles.accent}>.</span></h1><p className={styles.lead}>Создай первую вакансию, чтобы увидеть кандидатов вокруг вакансий твоей команды.</p></div></div><div className={styles.actions}><Button variant="cta" href="/employer/needs/new">+ Новая вакансия</Button><Button href="/employer/search">Поиск по базе →</Button></div></div>;
}
