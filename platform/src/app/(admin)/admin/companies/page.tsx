import Link from 'next/link';
import { companyDisplayName } from '@/lib/company-brand';

import { FilterForm } from '@/components/admin/FilterForm';
import { Pager } from '@/components/admin/Pager';
import { Tag } from '@/components/ui';
import { CompanyListQuery, listCompanies } from '@/server/admin/overview/lists';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import { flatParams, withoutPage } from '../listing';

const BAND = { low: 'низкий', medium: 'средний', high: 'высокий' } as const;

/** Компании: ИНН, проверка, блокировка, индекс доверия (концепция). */
export default async function AdminCompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageStaff('/admin/companies', 'view_companies');
  const raw = flatParams(await searchParams);
  const data = await listCompanies(CompanyListQuery.parse(raw));
  return (
    <>
      <h1 className={styles.title}>Компании</h1>
      <FilterForm
        action="/admin/companies"
        values={raw}
        fields={[
          { name: 'q', label: 'Поиск', type: 'text', placeholder: 'Название, ИНН или id' },
          { name: 'verified', label: 'Проверка', type: 'select', options: [['yes', 'проверена'], ['no', 'не проверена'], ['requested', 'ждёт проверки']] },
          { name: 'blocked', label: 'Блокировка', type: 'select', options: [['yes', 'заблокирована'], ['no', 'не заблокирована']] },
        ]}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Компания</th>
            <th>ИНН</th>
            <th>Доверие</th>
            <th>Потребности</th>
            <th>Приглашения</th>
            <th>Метки</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/admin/companies/${c.id}`}>{companyDisplayName(c.name)}</Link>
              </td>
              <td className={styles.mono}>{c.inn ?? '–'}</td>
              <td>{c.trust === null ? '–' : `${c.trust} (${BAND[c.trustBand!]})`}</td>
              <td>{c.vacancies}</td>
              <td>{c.invitations}</td>
              <td className={styles.row}>
                {c.isDemo && <Tag>демо</Tag>}
                {c.verified && <Tag tone="solid">проверена</Tag>}
                {c.verificationRequested && <Tag tone="outline">ждёт проверки</Tag>}
                {c.blocked && <Tag tone="dashed">заблокирована</Tag>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
      <Pager basePath="/admin/companies" params={withoutPage(raw)} page={data.page} pages={data.pages} total={data.total} />
    </>
  );
}
