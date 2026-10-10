import type { Metadata } from 'next';

import { CandidateInvitations } from '@/components/candidate/CandidateInvitations';
import { requirePageCandidate } from '@/server/auth/page';
import { getCandidateContact, listCandidateInvitations } from '@/server/employer';

export const metadata: Metadata = { title: 'Приглашения - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Входящие приглашения кандидата (R-C-11, R-C-16), контакт для компаний (Q-35) и настройка приватности (R-C-13). Открытие отмечает их просмотренными. */
export default async function CandidateInvitationsPage() {
  const s = await requirePageCandidate('/invitations');
  const [invitations, contact] = await Promise.all([
    listCandidateInvitations(s.candidateId, true),
    getCandidateContact(s.candidateId),
  ]);
  return <CandidateInvitations invitations={invitations} contact={contact.contact} />;
}
