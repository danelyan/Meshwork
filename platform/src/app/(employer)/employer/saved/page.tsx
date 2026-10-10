import type { Metadata } from 'next';
import { SavedCandidates } from '@/components/employer/SavedCandidates';
import styles from '@/components/employer/Employer.module.css';
import { Button } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { listCompanyInvitations, loadEmployerContext } from '@/server/employer';
import { savedCandidateCards } from '@/server/favorites';

export const metadata: Metadata = { title: 'Избранные кандидаты - ФСП Карьера' };
export const dynamic = 'force-dynamic';

export default async function SavedCandidatesPage() {
  const s = await requirePageEmployer('/employer/saved');
  const [ctx, result] = await Promise.all([loadEmployerContext(s.employerProfileId), savedCandidateCards(s)]);
  const invitations = await listCompanyInvitations(ctx.companyId);
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'sent' || invitation.status === 'viewed').map((invitation) => ({ candidateId: invitation.candidate.id, status: invitation.status }));
  return <div className={styles.page}>
    <div className={styles.head}><div><h1>Избранное<span className={styles.accent}>.</span></h1><p className={styles.lead}>Кандидаты, к которым ты хочешь вернуться. Избранное сохраняется в твоём аккаунте и доступно на других устройствах. Кандидаты о нём не узнают.</p></div><Button href="/employer/search">Поиск по базе →</Button></div>
    <SavedCandidates scope={s.userId} cards={result.cards} unavailable={result.unavailable} pendingInvitations={pendingInvitations} />
  </div>;
}
