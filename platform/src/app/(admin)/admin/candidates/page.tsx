import Link from 'next/link';

import { FilterForm } from '@/components/admin/FilterForm';
import { FSP_LABEL, GRADE_LABEL, SPEC_LABEL, fmtDate } from '@/components/admin/labels';
import { Pager } from '@/components/admin/Pager';
import { Tag } from '@/components/ui';
import { CandidateListQuery, listCandidates } from '@/server/admin/overview/lists';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import { flatParams, withoutPage } from '../listing';

/** Кандидаты: псевдоним и текущая категория. Найти по почте может тот, у кого есть право раскрытия ПДн. */
export default async function AdminCandidatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePageStaff('/admin/candidates', 'view_candidates');
  const raw = flatParams(await searchParams);
  const q = CandidateListQuery.parse(raw);
  const canPii = can(staff.role, 'reveal_pii');
  const data = await listCandidates(q, canPii);
  return (
    <>
      <h1 className={styles.title}>Кандидаты</h1>
      <FilterForm
        action="/admin/candidates"
        values={raw}
        fields={[
          { name: 'q', label: 'Поиск', type: 'text', placeholder: canPii ? 'Почта, имя, псевдоним (#AB12CD) или id' : 'Псевдоним (#AB12CD) или id' },
          { name: 'specialization', label: 'Направление', type: 'select', options: Object.entries(SPEC_LABEL) },
          { name: 'grade', label: 'Грейд', type: 'select', options: Object.entries(GRADE_LABEL) },
          { name: 'fsp', label: 'ФСП', type: 'select', options: Object.entries(FSP_LABEL) },
          { name: 'hidden', label: 'Скрыт от работодателей', type: 'select', options: [['yes', 'скрыт'], ['no', 'виден']] },
          { name: 'demo', label: 'Демо', type: 'select', options: [['yes', 'демо'], ['no', 'не демо']] },
        ]}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Псевдоним</th>
            <th>Почта</th>
            <th>Категория</th>
            <th>ФСП</th>
            <th>Создан</th>
            <th>Метки</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/admin/candidates/${c.id}`}>{c.pseudonym}</Link>
              </td>
              <td className={styles.mono}>{c.email ?? '–'}</td>
              <td>{c.category ? `${SPEC_LABEL[c.category.specialization]} · ${GRADE_LABEL[c.category.grade]}` : (c.specialization ? `${SPEC_LABEL[c.specialization]} · без категории` : 'без категории')}</td>
              <td>{FSP_LABEL[c.fspState]}</td>
              <td className={styles.mono}>{fmtDate(c.createdAt)}</td>
              <td className={styles.row}>
                {c.isDemo && <Tag>демо</Tag>}
                {c.hidden && <Tag tone="outline">скрыт</Tag>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
      <Pager basePath="/admin/candidates" params={withoutPage(raw)} page={data.page} pages={data.pages} total={data.total} />
    </>
  );
}
