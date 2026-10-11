import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import styles from '@/components/candidate/Candidate.module.css';
import { Button, Kicker, Panel, Tag } from '@/components/ui';
import { specLabel } from '@/lib/directions';
import { GRADE_LABEL, isGrade } from '@/lib/grades';
import { requirePageCandidate } from '@/server/auth/page';
import { firstLine } from '@/server/companies/aggregate';
import { getCompanyDetail } from '@/server/companies/catalog';

export const metadata: Metadata = { title: 'Компании - ФСП Карьера' };
export const dynamic = 'force-dynamic';

const money = new Intl.NumberFormat('ru-RU');
type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  await requirePageCandidate(`/companies/${encodeURIComponent(id)}`);
  const company = await getCompanyDetail(id);
  if (!company) notFound();
  return <div className={styles.page}>
    <div><Button href="/companies" size="sm">← Все компании</Button></div>
    <header className={styles.heading}>
      <h1>{company.name}<i>.</i></h1>
      {company.industry && <Kicker>{company.industry}</Kicker>}
      {company.fullDescription && <p>{company.fullDescription}</p>}
    </header>
    <h2>Открытые вакансии: {company.vacancies.length}</h2>
    {company.vacancies.map((v) => <Panel key={v.id} className={styles.card}>
      <h2>{v.title}</h2>
      <div><Tag>{specLabel(v.specialization)} × {isGrade(v.grade) ? GRADE_LABEL[v.grade] : v.grade}</Tag> <Tag>{money.format(v.salaryFrom)} – {money.format(v.salaryTo)} ₽</Tag></div>
      {firstLine(v.description) && <p>{firstLine(v.description)}</p>}
    </Panel>)}
    <div><Button href="/career" variant="cta">Смотреть на карте соответствия и откликнуться</Button></div>
  </div>;
}
