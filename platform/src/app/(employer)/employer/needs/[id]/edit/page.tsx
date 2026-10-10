import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ArchiveButton } from '@/components/employer/ArchiveButton';
import styles from '@/components/employer/Employer.module.css';
import { VacancyForm } from '@/components/employer/VacancyForm';
import { Kicker } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { getCatalog } from '@/server/claims/catalog';
import { getVacancy, loadEmployerContext } from '@/server/employer';
import { AppError } from '@/server/errors';

export const metadata: Metadata = { title: 'Изменить потребность - ФСП Карьера' };
export const dynamic = 'force-dynamic';

export default async function EditNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePageEmployer(`/employer/needs/${id}/edit`);
  const ctx = await loadEmployerContext(s.employerProfileId);
  const v = await getVacancy(ctx.companyId, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const catalog = (await getCatalog()).map(({ id: cid, specialization, statement, grades, weight, weights }) => ({ id: cid, specialization, statement, grades, weight, weights }));
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Kicker>Потребность</Kicker>
          <h1>{v.title}</h1>
        </div>
        <ArchiveButton vacancyId={v.id} archived={v.archived} />
      </div>
      <VacancyForm
        catalog={catalog}
        vacancyId={v.id}
        initial={{
          title: v.title,
          specialization: v.specialization,
          grade: v.grade,
          salaryFrom: v.salaryFrom,
          salaryTo: v.salaryTo,
          teamDescription: v.teamDescription,
          description: v.description,
          stack: v.stack,
          needs: v.needs,
        }}
      />
    </div>
  );
}
