import type { Metadata } from 'next';
import { CandidateSettings } from '@/components/candidate/CandidateSettings';
import { requirePageCandidate } from '@/server/auth/page';
import { getProfile } from '@/server/claims';
import { getCandidateContact, getPrivacy } from '@/server/employer';
import { fspProviderMode } from '@/server/fsp-id/client';
import { fspLinkView } from '@/server/fsp-id/link';

export const metadata: Metadata = { title: 'Настройки - ФСП Карьера' };

/** Итог возврата от ФСП ID (`/api/fsp-id/callback` → `?fsp=`): только известные коды, остальное игнорируем. */
const FSP_RESULTS = new Set(['linked', 'no_achievements', 'unavailable', 'error_denied', 'error_state', 'error_session', 'error_exchange', 'error_token', 'error_unavailable', 'error_internal']);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePageCandidate('/settings');
  const [profile, privacy, contact, sp] = await Promise.all([getProfile(session.candidateId), getPrivacy(session.candidateId), getCandidateContact(session.candidateId), searchParams]);
  const fsp = await fspLinkView(session.candidateId, profile.candidate.fspState);
  const raw = typeof sp.fsp === 'string' ? sp.fsp : null;
  return <CandidateSettings hidden={privacy.hiddenFromEmployers} contact={contact.contact} fspState={profile.candidate.fspState} fsp={fsp} fspProvider={fspProviderMode()} fspResult={raw && FSP_RESULTS.has(raw) ? raw : null} />;
}
