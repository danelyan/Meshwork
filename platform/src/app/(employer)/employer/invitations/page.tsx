import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { InvitationTracker } from '@/components/employer/InvitationTracker';
import { Kicker, Meter } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { invitationsSentToday, listCompanyInvitations, loadEmployerContext } from '@/server/employer';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';

export const metadata: Metadata = { title: 'Приглашения - ФСП Карьера' };
export const dynamic = 'force-dynamic';

export default async function EmployerInvitationsPage() {
  const s = await requirePageEmployer('/employer/invitations');
  const ctx = await loadEmployerContext(s.employerProfileId);
  const [invitations, sent] = await Promise.all([listCompanyInvitations(ctx.companyId), invitationsSentToday(ctx.companyId)]);
  return <div className={styles.page}>
    <div className={styles.head}>
      <div><Kicker>{ctx.companyName}</Kicker><h1>Приглашения.</h1><p className={styles.lead}>Статусы видят обе стороны. Имя и контакт кандидата откроются, когда он примет приглашение.</p></div>
      <div className={styles.invitationLimit}><span className={styles.status}>За последние сутки: {sent} из {DAILY_INVITATION_LIMIT}</span><Meter value={sent} max={DAILY_INVITATION_LIMIT} label="Использовано приглашений за сутки" /><small>Лимит защищает кандидатов от массовых рассылок</small></div>
    </div>
    <InvitationTracker invitations={invitations} />
  </div>;
}
