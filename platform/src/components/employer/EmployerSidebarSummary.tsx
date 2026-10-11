import { Meter } from '@/components/ui';
import { invitationsSentToday, loadEmployerContext } from '@/server/employer';
import { getSetting } from '@/server/admin/settings';
import styles from './Employer.module.css';

export async function EmployerSidebarSummary({ employerProfileId }: { employerProfileId: string }) {
  const context = await loadEmployerContext(employerProfileId);
  const [sent, dailyLimit] = await Promise.all([invitationsSentToday(context.companyId), getSetting('employer.dailyInvitationLimit')]);
  return <div className={styles.sidebarQuota}><span className={styles.status}>Лимит приглашений</span><strong>{sent} <span>из {dailyLimit}</span></strong><Meter value={sent} max={dailyLimit} label="Использовано приглашений за последние сутки" /><p>За последние 24 часа. Лимит защищает кандидатов от массовых рассылок.</p></div>;
}
