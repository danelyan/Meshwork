import type { Metadata } from 'next';
import { CandidateSettings } from '@/components/candidate/CandidateSettings';
import { requirePageCandidate } from '@/server/auth/page';
import { getProfile } from '@/server/claims';
import { getCandidateContact, getPrivacy } from '@/server/employer';

export const metadata: Metadata = { title: 'Настройки - ФСП Карьера' };

export default async function Page() {
  const session = await requirePageCandidate('/settings');
  const [profile, privacy, contact] = await Promise.all([getProfile(session.candidateId), getPrivacy(session.candidateId), getCandidateContact(session.candidateId)]);
  return <CandidateSettings hidden={privacy.hiddenFromEmployers} contact={contact.contact} fspState={profile.candidate.fspState} />;
}
