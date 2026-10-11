import Link from 'next/link';

import { FilterForm } from '@/components/admin/FilterForm';
import { APPLICATION_STATUS_LABEL, fmtDate } from '@/components/admin/labels';
import { Pager } from '@/components/admin/Pager';
import { ApplicationListQuery, listApplications } from '@/server/admin/overview/lists';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import { flatParams, withoutPage } from '../listing';

/** Самоотклики кандидатов на вакансии (R-C-12). Доступ — право просмотра приглашений. */
export default async function AdminApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageStaff('/admin/applications', 'view_invitations');
  const raw = flatParams(await searchParams);
  const data = await listApplications(ApplicationListQuery.parse(raw));
  return (
    <>
      <h1 className={styles.title}>Самоотклики</h1>
      <p className={styles.muted}>
        <Link href="/admin/invitations">Приглашения работодателей</Link>
      </p>
      <FilterForm
        action="/admin/applications"
        values={raw}
        fields={[
          { name: 'q', label: 'Поиск', type: 'text', placeholder: 'Вакансия, компания, id отклика или кандидата' },
          { name: 'status', label: 'Статус', type: 'select', options: Object.entries(APPLICATION_STATUS_LABEL) },
        ]}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Когда</th>
            <th>Кандидат</th>
            <th>Вакансия</th>
            <th>Компания</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((a) => (
            <tr key={a.id}>
              <td className={styles.mono}>{fmtDate(a.createdAt)}</td>
              <td>
                <Link href={`/admin/candidates/${a.candidateId}`}>{a.candidate}</Link>
              </td>
              <td>
                <Link href={`/admin/vacancies/${a.vacancy.id}`}>{a.vacancy.title}</Link>
              </td>
              <td>
                <Link href={`/admin/companies/${a.company.id}`}>{a.company.name}</Link>
              </td>
              <td>
                {APPLICATION_STATUS_LABEL[a.status]}
                {a.closeReason ? ` (${a.closeReason})` : ''}
                {a.invitationId && (
                  <>
                    {' '}
                    <Link href={`/admin/invitations/${a.invitationId}`}>→ приглашение</Link>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
      <Pager basePath="/admin/applications" params={withoutPage(raw)} page={data.page} pages={data.pages} total={data.total} />
    </>
  );
}
