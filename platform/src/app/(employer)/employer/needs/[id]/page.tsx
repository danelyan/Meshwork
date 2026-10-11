import type { Metadata } from 'next';
import { companyDisplayName } from '@/lib/company-brand';
import { notFound } from 'next/navigation';
import styles from '@/components/employer/Employer.module.css';
import { MatchResults } from '@/components/employer/MatchResults';
import { VacancyApplications } from '@/components/employer/VacancyApplications';
import { VacancySwitcher } from '@/components/employer/VacancySwitcher';
import { EmployerProjectBlock } from '@/components/project/EmployerProjectBlock';
import { Button, Notice } from '@/components/ui';
import { EmployerConsentGate } from '@/components/consent/EmployerConsentGate';
import { requirePageEmployer } from '@/server/auth/page';
import { employerConsentsMissing } from '@/server/consent/service';
import { listVacancies, loadEmployerContext, matchForVacancy } from '@/server/employer';
import { parseFilters } from '@/server/employer/schemas';
import { AppError } from '@/server/errors';
import { projectBlockData } from '@/server/project/page-data';

export const metadata: Metadata = { title: 'Подборка - MESHWORK' };
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function NeedMatchesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const s = await requirePageEmployer(`/employer/needs/${encodeURIComponent(id)}`);
  const ctx = await loadEmployerContext(s.employerProfileId);
  // ADR 0005: без оферты и обязательства по данным – вместо подборки форма принятия условий.
  if ((await employerConsentsMissing(s.userId)).length) return <div className={styles.page}><h1>Подборка<span className={styles.accent}>.</span></h1><EmployerConsentGate /></div>;
  const { filters, limit } = parseFilters(await searchParams);
  const result = await matchForVacancy(ctx.companyId, id, filters, limit).catch((error: unknown) => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  const v = result.vacancy!;
  const [project, allVacancies] = await Promise.all([projectBlockData(ctx.companyId, v), listVacancies(ctx.companyId)]);
  const vacancies = allVacancies.filter((vacancy) => !vacancy.archived || vacancy.id === v.id);
  const basePath = `/employer/needs/${encodeURIComponent(v.id)}`;
  return <div className={styles.page}>
    <div className={styles.head}><div><h1>Подборка<br />под вакансию<span className={styles.accent}>.</span></h1><p className={styles.lead}>Кандидаты вокруг вакансий твоей команды. Выбери человека на карте, чтобы увидеть, какие требования он закрывает и чем это подтверждено.</p></div><Button href={`${basePath}/edit`} size="sm">Изменить вакансию</Button></div>
    {v.archived && <Notice>Вакансия закрыта. Эта подборка доступна для просмотра.</Notice>}
    <VacancySwitcher vacancies={vacancies} currentId={v.id} />
    <MatchResults result={result} basePath={basePath} favoriteScope={s.employerProfileId} companyName={companyDisplayName(ctx.companyName)} />
    <VacancyApplications vacancyId={v.id} />
    <details className={styles.evidenceDetails}><summary>Задание для проекта и проверка навыков</summary><EmployerProjectBlock vacancyId={v.id} specialization={v.specialization} grade={v.grade} salaryFrom={v.salaryFrom} salaryTo={v.salaryTo} archived={v.archived} initialTask={project.task} templates={project.templates} criteriaOptions={project.criteriaOptions} /></details>
  </div>;
}
