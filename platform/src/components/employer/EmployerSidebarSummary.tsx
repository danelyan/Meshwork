import { Meter } from '@/components/ui';
import { invitationsSentToday, loadEmployerContext } from '@/server/employer';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';
import styles from './Employer.module.css';

export async function EmployerSidebarSummary({ employerProfileId }: { employerProfileId: string }) {
  const context = await loadEmployerContext(employerProfileId);
  const sent = await invitationsSentToday(context.companyId);
  return <div className={styles.sidebarQuota}><span className={styles.status}>Лимит приглашений</span><strong>{sent} <span>из {DAILY_INVITATION_LIMIT}</span></strong><Meter value={sent} max={DAILY_INVITATION_LIMIT} label="Использовано приглашений за последние сутки" /><p>За последние 24 часа. Лимит защищает кандидатов от массовых рассылок.</p></div>;
}
