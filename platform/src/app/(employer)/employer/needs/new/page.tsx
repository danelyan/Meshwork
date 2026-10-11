import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { VacancyEntry } from '@/components/employer/VacancyEntry';
import { Notice } from '@/components/ui';
import { parseNeedPrefill } from '@/server/agent/employer/prefill';
import { requirePageEmployer } from '@/server/auth/page';
import { getCatalog } from '@/server/claims/catalog';

export const metadata: Metadata = { title: 'Новая вакансия - MESHWORK' };
export const dynamic = 'force-dynamic';

/** `?spec=…&grade=…&needs=…` – черновик помощника (create_need_draft): форма предзаполнена, сохраняет человек. */
export default async function NewNeedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageEmployer('/employer/needs/new');
  const catalog = (await getCatalog()).map(({ id, specialization, statement, grades, weight, weights }) => ({ id, specialization, statement, grades, weight, weights }));
  const prefill = parseNeedPrefill(await searchParams, catalog);
  return (
    <div className={styles.page}>
      <div>
        <h1>Новая вакансия<span className={styles.accent}>.</span></h1>
        <p className={styles.lead}>Начни с направления. Укажи задачи команды, уровень, стек и зарплатную вилку, чтобы получить подборку по подтверждённым навыкам.</p>
      </div>
      {prefill && <Notice>Черновик помощника: проверь поля и требования и сохрани - без сохранения вакансия не создаётся.</Notice>}
      <VacancyEntry catalog={catalog} initial={prefill ?? undefined} />
    </div>
  );
}
