import Link from 'next/link';

import { FilterForm } from '@/components/admin/FilterForm';
import { GRADE_LABEL, SPEC_LABEL, fmtDate, fmtMoney } from '@/components/admin/labels';
import { Pager } from '@/components/admin/Pager';
import { Tag } from '@/components/ui';
import { VacancyListQuery, listVacancies } from '@/server/admin/overview/lists';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import { flatParams, withoutPage } from '../listing';

/** Потребности и вакансии компаний. */
export default async function AdminVacanciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageStaff('/admin/vacancies', 'view_vacancies');
  const raw = flatParams(await searchParams);
  const data = await listVacancies(VacancyListQuery.parse(raw));
  return (
    <>
      <h1 className={styles.title}>Вакансии и потребности</h1>
      <FilterForm
        action="/admin/vacancies"
        values={raw}
        fields={[
          { name: 'q', label: 'Поиск', type: 'text', placeholder: 'Название, компания или id' },
          { name: 'specialization', label: 'Направление', type: 'select', options: Object.entries(SPEC_LABEL) },
          { name: 'grade', label: 'Грейд', type: 'select', options: Object.entries(GRADE_LABEL) },
          { name: 'state', label: 'Состояние', type: 'select', options: [['active', 'активные'], ['archived', 'в архиве']] },
        ]}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Название</th>
            <th>Компания</th>
            <th>Направление</th>
            <th>Вилка</th>
            <th>Приглашений</th>
            <th>Откликов</th>
            <th>Создана</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((v) => (
            <tr key={v.id}>
              <td>
                <Link href={`/admin/vacancies/${v.id}`}>{v.title}</Link> {v.archived && <Tag tone="outline">архив</Tag>}
              </td>
              <td>
                <Link href={`/admin/companies/${v.company.id}`}>{v.company.name}</Link>
              </td>
              <td>{`${SPEC_LABEL[v.specialization]} · ${GRADE_LABEL[v.grade]}`}</td>
              <td>{fmtMoney(v.salaryFrom, v.salaryTo)}</td>
              <td>{v.invitations}</td>
              <td>{v.applications}</td>
              <td className={styles.mono}>{fmtDate(v.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
      <Pager basePath="/admin/vacancies" params={withoutPage(raw)} page={data.page} pages={data.pages} total={data.total} />
    </>
  );
}
