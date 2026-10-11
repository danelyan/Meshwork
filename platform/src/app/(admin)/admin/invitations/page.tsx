import Link from 'next/link';
import { companyDisplayName } from '@/lib/company-brand';

import { FilterForm } from '@/components/admin/FilterForm';
import { COMPLAINT_STATUS_LABEL, INVITATION_STATUS_LABEL, fmtDate, fmtMoney } from '@/components/admin/labels';
import { Pager } from '@/components/admin/Pager';
import { Tag } from '@/components/ui';
import { InvitationListQuery, listInvitations } from '@/server/admin/overview/lists';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import { flatParams, withoutPage } from '../listing';

/** Приглашения работодателей кандидатам; кандидат – под псевдонимом. Самоотклики – отдельным списком. */
export default async function AdminInvitationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageStaff('/admin/invitations', 'view_invitations');
  const raw = flatParams(await searchParams);
  const data = await listInvitations(InvitationListQuery.parse(raw));
  return (
    <>
      <h1 className={styles.title}>Приглашения</h1>
      <p className={styles.muted}>
        <Link href="/admin/applications">Самоотклики кандидатов</Link>
      </p>
      <FilterForm
        action="/admin/invitations"
        values={raw}
        fields={[
          { name: 'q', label: 'Поиск', type: 'text', placeholder: 'Компания, потребность или id' },
          { name: 'status', label: 'Статус', type: 'select', options: Object.entries(INVITATION_STATUS_LABEL) },
          { name: 'complaint', label: 'Жалоба', type: 'select', options: [['yes', 'есть жалоба']] },
        ]}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Когда</th>
            <th>Компания</th>
            <th>Потребность</th>
            <th>Кандидат</th>
            <th>Вилка</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id}>
              <td className={styles.mono}>
                <Link href={`/admin/invitations/${i.id}`}>{fmtDate(i.createdAt)}</Link>
              </td>
              <td>{i.company ? <Link href={`/admin/companies/${i.company.id}`}>{companyDisplayName(i.company.name)}</Link> : '–'}</td>
              <td>{i.vacancy ? <Link href={`/admin/vacancies/${i.vacancy.id}`}>{i.vacancy.title}</Link> : 'без потребности'}</td>
              <td>
                <Link href={`/admin/candidates/${i.candidateId}`}>{i.candidate}</Link>
              </td>
              <td>{fmtMoney(i.salaryFrom, i.salaryTo)}</td>
              <td className={styles.row}>
                {INVITATION_STATUS_LABEL[i.status]}
                {i.complaint && <Tag tone="dashed">жалоба: {COMPLAINT_STATUS_LABEL[i.complaint]}</Tag>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
      <Pager basePath="/admin/invitations" params={withoutPage(raw)} page={data.page} pages={data.pages} total={data.total} />
    </>
  );
}
