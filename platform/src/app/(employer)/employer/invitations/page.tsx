import { EmployerConsentGate } from '@/components/consent/EmployerConsentGate';
import { employerConsentsMissing } from '@/server/consent/service';
import type { Metadata } from 'next';

import styles from '@/components/employer/Employer.module.css';
import { InvitationTracker } from '@/components/employer/InvitationTracker';
import { SanctionAppealForm } from '@/components/employer/SanctionAppealForm';
import { listCompanyAppeals } from '@/server/admin/moderation/appeals';
import { Meter, Notice } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { companySanction, invitationsSentToday, listCompanyInvitations, loadEmployerContext } from '@/server/employer';
import { getSetting } from '@/server/admin/settings';

export const metadata: Metadata = { title: 'Приглашения - MESHWORK' };
export const dynamic = 'force-dynamic';

export default async function EmployerInvitationsPage() {
  const s = await requirePageEmployer('/employer/invitations');
  // ADR 0005: без оферты и обязательства по данным — вместо данных кандидатов форма принятия условий.
  if ((await employerConsentsMissing(s.userId)).length) return <div className={styles.page}><h1>Приглашения</h1><EmployerConsentGate /></div>;
  const ctx = await loadEmployerContext(s.employerProfileId);
  const [invitations, sent, sanction, appeals] = await Promise.all([listCompanyInvitations(ctx.companyId), invitationsSentToday(ctx.companyId), companySanction(ctx.companyId), listCompanyAppeals(ctx.companyId)]);
  const [baseLimit, windowDays] = await Promise.all([getSetting('employer.dailyInvitationLimit'), getSetting('employer.complaintWindowDays')]);
  const openAppeal = appeals.find((a) => a.status === 'open') ?? null;
  const perDay = sanction.level === 'none' ? baseLimit : sanction.limit;
  return <div className={styles.page}>
    <div className={styles.head}>
      <div><h1>Приглашения<span className={styles.accent}>.</span></h1><p className={styles.lead}>Статусы видят обе стороны. Имя и контакт кандидата откроются, когда он примет приглашение.</p></div>
      <div className={styles.invitationLimit}><span className={styles.status}>За последние сутки: {sent} из {perDay}</span><Meter value={sent} max={Math.max(perDay, 1)} label="Использовано приглашений за сутки" /><small>Лимит защищает кандидатов от массовых рассылок</small></div>
    </div>
    {sanction.level !== 'none' && <Notice tone="error" role="alert" data-testid="complaint-sanction">{sanction.level === 'blocked' ? `Отправка приглашений приостановлена: ${sanction.complaints} жалоб кандидатов за ${windowDays} дней.` : `Лимит снижен до ${sanction.limit} приглашений в сутки: ${sanction.complaints} жалобы кандидатов за ${windowDays} дней.`} Проверьте тексты и вилки приглашений: жалобы перестают учитываться через {windowDays} дней. Не согласны — оспорьте: апелляцию рассмотрит модератор.</Notice>}
    {sanction.level !== 'none' && <SanctionAppealForm open={openAppeal} />}
    <InvitationTracker invitations={invitations} />
  </div>;
}
