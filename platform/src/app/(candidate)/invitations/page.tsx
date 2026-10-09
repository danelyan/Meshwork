import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import styles from '@/components/employer/Employer.module.css';
import { IncomingInvitations } from '@/components/employer/IncomingInvitations';
import { PrivacyToggle } from '@/components/employer/PrivacyToggle';
import { Kicker } from '@/components/ui';
import { getPageSession } from '@/server/auth/page';
import { getPrivacy, listCandidateInvitations } from '@/server/employer';

export const metadata: Metadata = { title: 'Приглашения — ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Входящие приглашения кандидата (R-C-11, R-C-16) и настройка приватности (R-C-13). Открытие отмечает их просмотренными. */
export default async function CandidateInvitationsPage() {
  const s = await getPageSession();
  if (!s) redirect('/auth?next=%2Finvitations');
  if (!s.candidateId) redirect(s.employerProfileId ? '/employer' : '/onboarding');
  const [invitations, privacy] = await Promise.all([listCandidateInvitations(s.candidateId, true), getPrivacy(s.candidateId)]);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>Работодатели</Kicker>
        <h1>Приглашения</h1>
        <p className={styles.lead}>Компании сами находят вас по подтверждённым карточкам и пишут, сколько готовы платить.</p>
      </div>
      <IncomingInvitations invitations={invitations} />
      <PrivacyToggle hidden={privacy.hiddenFromEmployers} />
    </div>
  );
}
