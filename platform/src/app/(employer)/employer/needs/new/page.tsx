import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { VacancyForm } from '@/components/employer/VacancyForm';
import { Kicker, Notice } from '@/components/ui';
import { parseNeedPrefill } from '@/server/agent/employer/prefill';
import { requirePageEmployer } from '@/server/auth/page';
import { getCatalog } from '@/server/claims/catalog';

export const metadata: Metadata = { title: 'Новая потребность - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** `?spec=…&grade=…&needs=…` — черновик помощника (create_need_draft): форма предзаполнена, сохраняет человек. */
export default async function NewNeedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageEmployer('/employer/needs/new');
  const catalog = (await getCatalog()).map(({ id, specialization, statement, grades, weight, weights }) => ({ id, specialization, statement, grades, weight, weights }));
  const prefill = parseNeedPrefill(await searchParams, catalog);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>Потребность</Kicker>
        <h1>Кто нужен команде</h1>
        <p className={styles.lead}>По требованиям платформа ранжирует кандидатов и объясняет, что каждый уже доказал.</p>
      </div>
      {prefill && <Notice>Черновик помощника: проверь поля и требования и сохрани - без сохранения потребность не создаётся.</Notice>}
      <VacancyForm catalog={catalog} initial={prefill ?? undefined} />
    </div>
  );
}
