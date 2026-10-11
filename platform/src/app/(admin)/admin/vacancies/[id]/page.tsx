import Link from 'next/link';
import { companyDisplayName } from '@/lib/company-brand';

import { VacancyActions } from '@/components/admin/actions';
import { APPLICATION_STATUS_LABEL, GRADE_LABEL, INVITATION_STATUS_LABEL, SPEC_LABEL, fmtDate, fmtDateTime, fmtMoney } from '@/components/admin/labels';
import { Panel } from '@/components/ui';
import { getVacancyCard } from '@/server/admin/overview/cards';
import { isVacancyHidden } from '@/server/admin/moderation/red-flags';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../../admin.module.css';
import { orNotFound } from '../../listing';

/** Карточка потребности: условия, стек, приглашения и самоотклики (кандидаты под псевдонимами). */
export default async function AdminVacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff(`/admin/vacancies/${id}`, 'view_vacancies');
  const v = await orNotFound(getVacancyCard(id));
  const hidden = await isVacancyHidden(id);
  return (
    <>
      <h1 className={styles.title}>{v.title}</h1>
      <Panel className={styles.section}>
        <dl className={styles.kv}>
          <dt>id</dt>
          <dd className={styles.mono}>{v.id}</dd>
          <dt>Компания</dt>
          <dd>
            <Link href={`/admin/companies/${v.company.id}`}>{companyDisplayName(v.company.name)}</Link>
          </dd>
          <dt>Направление</dt>
          <dd>{`${SPEC_LABEL[v.specialization]} · ${GRADE_LABEL[v.grade]}`}</dd>
          <dt>Вилка</dt>
          <dd>{fmtMoney(v.salaryFrom, v.salaryTo)}</dd>
          <dt>Стек</dt>
          <dd>{v.stack.join(', ') || '—'}</dd>
          <dt>Описание</dt>
          <dd>{v.description ?? '—'}</dd>
          <dt>Команда</dt>
          <dd>{v.teamDescription ?? '—'}</dd>
          <dt>Состояние</dt>
          <dd>{v.archivedAt ? `в архиве с ${fmtDateTime(v.archivedAt)}` : 'активна'}</dd>
          <dt>Создана</dt>
          <dd>{fmtDateTime(v.createdAt)}</dd>
        </dl>
      </Panel>
      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Приглашения ({v.invitations.length})</h2>
        <ul>
          {v.invitations.map((i) => (
            <li key={i.id}>
              <Link href={`/admin/invitations/${i.id}`}>{i.candidate}</Link>: {INVITATION_STATUS_LABEL[i.status]}, {fmtDate(i.createdAt)}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Самоотклики ({v.applications.length})</h2>
        <ul>
          {v.applications.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/candidates/${a.candidateId}`}>{a.candidate}</Link>: {APPLICATION_STATUS_LABEL[a.status]}, {fmtDate(a.createdAt)}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className={styles.actions}>
        <h2 className={styles.sectionTitle}>Действия</h2>
        <VacancyActions vacancyId={v.id} hidden={hidden} canHide={can(staff.role, 'hide_vacancy')} />
      </Panel>
    </>
  );
}
