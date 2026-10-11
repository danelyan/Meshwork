import Link from 'next/link';

import { FilterForm } from '@/components/admin/FilterForm';
import { USER_ROLE_LABEL, fmtDate } from '@/components/admin/labels';
import { Pager } from '@/components/admin/Pager';
import { Tag } from '@/components/ui';
import { can } from '@/server/admin/permissions';
import { UserListQuery, listUsers } from '@/server/admin/overview/lists';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import { flatParams, withoutPage } from '../listing';

/** Пользователи: учётные записи с масками имени и почты. Раскрытие — в карточке. */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePageStaff('/admin/users', 'view_users');
  const raw = flatParams(await searchParams);
  const q = UserListQuery.parse(raw);
  const canPii = can(staff.role, 'reveal_pii');
  const data = await listUsers(q, canPii);
  return (
    <>
      <h1 className={styles.title}>Пользователи</h1>
      <FilterForm
        action="/admin/users"
        values={raw}
        fields={[
          { name: 'q', label: 'Поиск', type: 'text', placeholder: canPii ? 'Почта, имя или id' : 'id' },
          { name: 'role', label: 'Роль', type: 'select', options: Object.entries(USER_ROLE_LABEL) },
          { name: 'blocked', label: 'Блокировка', type: 'select', options: [['yes', 'заблокирован'], ['no', 'не заблокирован']] },
          { name: 'demo', label: 'Демо', type: 'select', options: [['yes', 'демо'], ['no', 'не демо']] },
        ]}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Учётка</th>
            <th>Имя</th>
            <th>Почта</th>
            <th>Роль</th>
            <th>Создана</th>
            <th>Метки</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id}>
              <td className={styles.mono}>
                <Link href={`/admin/users/${u.id}`}>{u.id}</Link>
              </td>
              <td>{u.name ?? '—'}</td>
              <td className={styles.mono}>{u.email ?? '—'}</td>
              <td>{USER_ROLE_LABEL[u.role]}</td>
              <td className={styles.mono}>{fmtDate(u.createdAt)}</td>
              <td className={styles.row}>
                {u.isDemo && <Tag>демо</Tag>}
                {u.blocked && <Tag tone="dashed">заблокирован</Tag>}
                {!u.onboarded && <Tag tone="outline">без онбординга</Tag>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
      <Pager basePath="/admin/users" params={withoutPage(raw)} page={data.page} pages={data.pages} total={data.total} />
    </>
  );
}
