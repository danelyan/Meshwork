import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT, salaryRange } from '@/components/employer/labels';
import { Kicker, Notice } from '@/components/ui';
import { formatDate } from '@/lib/labels';
import { requirePageEmployer } from '@/server/auth/page';
import { invitationsSentToday, listCompanyInvitations, loadEmployerContext } from '@/server/employer';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';

export const metadata: Metadata = { title: 'Отправленные приглашения - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Трекинг приглашений (R-E-05): статус, зарплата, контакты после принятия (R-E-07). */
export default async function EmployerInvitationsPage() {
  const s = await requirePageEmployer('/employer/invitations');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const [invitations, sent] = await Promise.all([listCompanyInvitations(ctx.companyId), invitationsSentToday(ctx.companyId)]);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>{ctx.companyName}</Kicker>
        <h1>Отправленные приглашения</h1>
        <p className={styles.lead}>
          За последние сутки отправлено {sent} из {DAILY_INVITATION_LIMIT}. Имя и контакт кандидата появляются после того, как он примет
          приглашение.
        </p>
      </div>
      {invitations.length === 0 ? (
        <Notice>Приглашений пока нет. Открой подборку по потребности или поиск по базе и пригласи кандидата.</Notice>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Кандидат</th>
                <th scope="col">Потребность</th>
                <th scope="col">Зарплата</th>
                <th scope="col">Статус</th>
                <th scope="col">Отправлено</th>
                <th scope="col">Контакты</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    {inv.candidate.displayName}
                    {inv.candidate.category && <div className={styles.meta}>{inv.candidate.category.label}</div>}
                  </td>
                  <td>{inv.vacancy?.title ?? 'без привязки'}</td>
                  <td>{salaryRange(inv.salaryFrom, inv.salaryTo)}</td>
                  <td>
                    <span className={styles.status}>{INVITATION_STATUS_LABEL[inv.status]}</span>
                  </td>
                  <td>{formatDate(inv.createdAt)}</td>
                  <td>{inv.candidate.contacts ? (inv.candidate.contacts.contact ?? NO_CANDIDATE_CONTACT) : 'скрыты до принятия'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
