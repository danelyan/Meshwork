import type { Metadata } from 'next';

import { CandidateApplications } from '@/components/candidate/CandidateApplications';
import { CandidateInvitations } from '@/components/candidate/CandidateInvitations';
import { requirePageCandidate } from '@/server/auth/page';
import { hasCallConsent } from '@/server/call/consent';
import { getCandidateContact, listCandidateInvitations } from '@/server/employer';
import { listCandidateApplications } from '@/server/employer/applications';

export const metadata: Metadata = { title: 'Приглашения - MESHWORK' };
export const dynamic = 'force-dynamic';

/** Входящие приглашения кандидата (R-C-11, R-C-16), мои отклики (R-C-12), контакт для компаний (Q-35) и настройка приватности (R-C-13). Открытие отмечает их просмотренными. */
export default async function CandidateInvitationsPage() {
  const s = await requirePageCandidate('/invitations');
  const [invitations, contact, recording, applications] = await Promise.all([
    listCandidateInvitations(s.candidateId, true),
    getCandidateContact(s.candidateId),
    hasCallConsent(s.candidateId),
    listCandidateApplications(s.candidateId),
  ]);
  // R-C-12: свои отклики – на той же странице, что входящие приглашения.
  return <><CandidateInvitations invitations={invitations} contact={contact.contact} hasRecordingConsent={recording} /><CandidateApplications applications={applications} /></>;
}
