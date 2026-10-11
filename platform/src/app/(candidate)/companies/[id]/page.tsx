import type { Metadata } from 'next';
import { companyDisplayName, companyDisplayDescription } from '@/lib/company-brand';
import { notFound } from 'next/navigation';
import styles from '@/components/candidate/Candidate.module.css';
import { Button, Kicker, Tag } from '@/components/ui';
import { specLabel } from '@/lib/directions';
import { CompanyVacancyCard } from '@/components/candidate/CompanyVacancyCard';
import { requirePageCandidate } from '@/server/auth/page';
import { getCompanyDetail } from '@/server/companies/catalog';
import { careerVacancies } from '@/server/recommend/career';

export const metadata: Metadata = { title: 'Компании - MESHWORK' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const { candidateId } = await requirePageCandidate(`/companies/${encodeURIComponent(id)}`);
  const company = await getCompanyDetail(id);
  if (!company) notFound();
  const view = await careerVacancies(candidateId);
  const vacancies = view.targets.filter((t) => t.companyId === id);
  return <div className={styles.page}>
    <div><Button href="/companies" size="sm">← Все компании</Button></div>
    <header className={styles.heading}>
      <h1>{companyDisplayName(company.name)}<i>.</i></h1>
      {company.industry && <Kicker>{company.industry}</Kicker>}
      {companyDisplayDescription(company.name, company.fullDescription)?.split('\n').filter((l) => l.trim()).map((l, i) => <p key={i}>{l}</p>)}
      <p>Открытых вакансий: {vacancies.length}{company.specializations.length > 0 && <> · {company.specializations.map((s) => <Tag key={s}>{specLabel(s)}</Tag>)}</>}</p>
    </header>
    {vacancies.map((v) => <CompanyVacancyCard key={v.vacancyId} vacancy={v} categories={view.categories} />)}
  </div>;
}
