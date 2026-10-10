import type { Metadata } from 'next';

import { ContactForm } from '@/components/employer/ContactForm';
import styles from '@/components/employer/Employer.module.css';
import { IncomingInvitations } from '@/components/employer/IncomingInvitations';
import { PrivacyToggle } from '@/components/employer/PrivacyToggle';
import { Kicker } from '@/components/ui';
import { requirePageCandidate } from '@/server/auth/page';
import { getCandidateContact, getPrivacy, listCandidateInvitations } from '@/server/employer';

export const metadata: Metadata = { title: 'Приглашения - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Входящие приглашения кандидата (R-C-11, R-C-16), контакт для компаний (Q-35) и настройка приватности (R-C-13). Открытие отмечает их просмотренными. */
export default async function CandidateInvitationsPage() {
  const s = await requirePageCandidate('/invitations');
  const [invitations, privacy, contact] = await Promise.all([
    listCandidateInvitations(s.candidateId, true),
    getPrivacy(s.candidateId),
    getCandidateContact(s.candidateId),
  ]);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>Работодатели</Kicker>
        <h1>Приглашения</h1>
        <p className={styles.lead}>Компании сами находят тебя по подтверждённым карточкам и пишут вилку и способ связи - всё это видно до того, как ты ответишь.</p>
      </div>
      <IncomingInvitations invitations={invitations} />
      <ContactForm contact={contact.contact} />
      <PrivacyToggle hidden={privacy.hiddenFromEmployers} />
    </div>
  );
}
