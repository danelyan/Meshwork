import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import styles from '@/components/employer/Employer.module.css';
import { GRADE_LABEL, SPEC_LABEL, salaryRange } from '@/components/employer/labels';
import { MatchResults } from '@/components/employer/MatchResults';
import { Button, Kicker, Notice, Tag } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { loadEmployerContext, matchForVacancy } from '@/server/employer';
import { parseFilters } from '@/server/employer/schemas';
import { AppError } from '@/server/errors';

export const metadata: Metadata = { title: 'Подборка - ФСП Карьера' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Подборка по потребности (R-E-03, R-M-03), фильтры — query (R-M-04). */
export default async function NeedMatchesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const s = await requirePageEmployer(`/employer/needs/${encodeURIComponent(id)}`);
  const ctx = await loadEmployerContext(s.employerProfileId);
  const { filters, limit } = parseFilters(await searchParams);
  const result = await matchForVacancy(ctx.companyId, id, filters, limit).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const v = result.vacancy!;
  const basePath = `/employer/needs/${encodeURIComponent(v.id)}`;
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Kicker>Подборка по потребности</Kicker>
          <h1>{v.title}</h1>
          <div className={styles.meta}>
            <Tag tone="solid">
              {SPEC_LABEL[v.specialization]} · {GRADE_LABEL[v.grade]}
            </Tag>
            <span>{salaryRange(v.salaryFrom, v.salaryTo)}</span>
            {v.stack.length > 0 && <span>стек: {v.stack.join(', ')}</span>}
          </div>
        </div>
        <Button href={`${basePath}/edit`}>Изменить потребность</Button>
      </div>
      {v.archived && <Notice>Потребность закрыта. Подборка показана для справки; приглашать можно и без неё - из поиска по базе.</Notice>}
      <p className={styles.lead}>
        Порядок: покрытие требований с учётом уровня доказанности (со слов слабее артефакта, артефакт слабее третьей стороны и
        платформы), категория из теста усиливает покрытие, достижения ФСП дают небольшую прибавку. Только подтверждённые
        кандидатом карточки.
      </p>
      <MatchResults result={result} basePath={basePath} />
    </div>
  );
}
