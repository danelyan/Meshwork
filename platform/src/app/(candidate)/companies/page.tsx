import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/candidate/Candidate.module.css';
import { Kicker, Panel, Tag } from '@/components/ui';
import { specLabel } from '@/lib/directions';
import { requirePageCandidate } from '@/server/auth/page';
import { listCompanyCards } from '@/server/companies/catalog';

export const metadata: Metadata = { title: 'Компании - ФСП Карьера' };
export const dynamic = 'force-dynamic';

const money = new Intl.NumberFormat('ru-RU');

export default async function Page() {
  await requirePageCandidate('/companies');
  const companies = await listCompanyCards();
  return <div className={styles.page}>
    <header className={styles.heading}>
      <h1>Компании<i>.</i></h1>
      <p>Компании с открытыми вакансиями. Работодатель сам находит вас в базе и присылает приглашение с зарплатой.</p>
    </header>
    {!companies.length ? <Panel className={styles.empty}><h2>Пока нет компаний с открытыми вакансиями</h2></Panel> : <>
      <span role="status">Компаний: {companies.length}</span>
      {companies.map((c) => <Panel key={c.id} className={styles.card}>
        <div className={styles.cardHead}><h2><Link href={`/companies/${encodeURIComponent(c.id)}`}>{c.name}</Link></h2>{c.industry && <Kicker>{c.industry}</Kicker>}</div>
        {c.summary && <p>{c.summary}</p>}
        <p>Открытых вакансий: {c.vacancyCount} · {money.format(c.salaryMin)} – {money.format(c.salaryMax)} ₽</p>
        {c.preview.length > 0 && <ul className={styles.requirements} aria-label="Вакансии">{c.preview.map((v) => <li key={v.id}>{v.title} <small className={styles.meta}>· {money.format(v.salaryFrom)} – {money.format(v.salaryTo)} ₽</small></li>)}{c.vacancyCount > c.preview.length && <li><small className={styles.meta}>и ещё {c.vacancyCount - c.preview.length}</small></li>}</ul>}
        <div>{c.specializations.map((s) => <Tag key={s}>{specLabel(s)}</Tag>)}</div>
      </Panel>)}
    </>}
  </div>;
}
