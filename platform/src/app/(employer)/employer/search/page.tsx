import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { MatchResults } from '@/components/employer/MatchResults';
import { Kicker } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { loadEmployerContext, searchBank } from '@/server/employer';
import { parseFilters } from '@/server/employer/schemas';

export const metadata: Metadata = { title: 'Поиск по базе - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Поиск по всему банку кандидатов (R-E-04): та же выдача без привязки к потребности. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requirePageEmployer('/employer/search');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const { filters, limit } = parseFilters(await searchParams);
  const result = await searchBank(ctx.companyId, filters, limit);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>Поиск по всей базе</Kicker>
        <h1>Кандидаты</h1>
        <p className={styles.lead}>
          Без потребности кандидат сравнивается с типичными требованиями своей категории (специализация и грейд из фильтра,
          иначе - из теста; без теста - Junior). Пригласить можно без привязки к вакансии.
        </p>
      </div>
      <MatchResults result={result} basePath="/employer/search" />
    </div>
  );
}
