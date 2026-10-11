import Link from 'next/link';

import { COMPLAINT_REASON_LABEL, COMPLAINT_STATUS_LABEL, INVITATION_STATUS_LABEL, fmtDateTime, fmtMoney } from '@/components/admin/labels';
import { Panel } from '@/components/ui';
import { getInvitationCard } from '@/server/admin/overview/cards';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../../admin.module.css';
import { orNotFound } from '../../listing';

/** Карточка приглашения: условия, ход статусов, жалоба и защиты. Решение по жалобе — в очереди модерации (фаза 2). */
export default async function AdminInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageStaff(`/admin/invitations/${id}`, 'view_invitations');
  const i = await orNotFound(getInvitationCard(id));
  return (
    <>
      <h1 className={styles.title}>Приглашение</h1>
      <Panel className={styles.section}>
        <dl className={styles.kv}>
          <dt>id</dt>
          <dd className={styles.mono}>{i.id}</dd>
          <dt>Компания</dt>
          <dd>{i.company ? <Link href={`/admin/companies/${i.company.id}`}>{i.company.name}</Link> : '—'}</dd>
          <dt>Потребность</dt>
          <dd>{i.vacancy ? <Link href={`/admin/vacancies/${i.vacancy.id}`}>{i.vacancy.title}</Link> : 'без потребности'}</dd>
          <dt>Кандидат</dt>
          <dd>
            <Link href={`/admin/candidates/${i.candidate.id}`}>{i.candidate.pseudonym}</Link>
          </dd>
          <dt>Вилка</dt>
          <dd>{fmtMoney(i.salaryFrom, i.salaryTo)}</dd>
          <dt>Сообщение</dt>
          <dd>{i.message ?? '—'}</dd>
          <dt>Статус</dt>
          <dd>{INVITATION_STATUS_LABEL[i.status]}</dd>
          <dt>Отправлено</dt>
          <dd>{fmtDateTime(i.createdAt)}</dd>
          <dt>Просмотрено</dt>
          <dd>{fmtDateTime(i.viewedAt)}</dd>
          <dt>Ответ</dt>
          <dd>{fmtDateTime(i.respondedAt)}</dd>
          {i.withdrawnAt && (
            <>
              <dt>Отозвано</dt>
              <dd>
                {fmtDateTime(i.withdrawnAt)}: {i.withdrawReason ?? '—'}
              </dd>
            </>
          )}
          {i.hiredAt && (
            <>
              <dt>Найм</dt>
              <dd>{fmtDateTime(i.hiredAt)}</dd>
            </>
          )}
        </dl>
      </Panel>
      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Жалоба</h2>
        {i.complaint ? (
          <p>
            {COMPLAINT_REASON_LABEL[i.complaint.reason]}, {COMPLAINT_STATUS_LABEL[i.complaint.status]}, {fmtDateTime(i.complaint.createdAt)}
            {i.complaint.comment ? `: ${i.complaint.comment}` : ''}
          </p>
        ) : (
          <p className={styles.muted}>Жалобы нет.</p>
        )}
      </Panel>
      {i.liveDefenses.length > 0 && (
        <Panel className={styles.section}>
          <h2 className={styles.sectionTitle}>Живые защиты</h2>
          <ul>
            {i.liveDefenses.map((d) => (
              <li key={d.id}>
                {d.status}, {fmtDateTime(d.startsAt)}
                {d.cancelReason ? `, отмена: ${d.cancelReason}` : ''}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
