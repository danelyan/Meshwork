import type { Metadata } from 'next';
import { CandidateSkills } from '@/components/candidate/CandidateSkills';
import { requirePageCandidate } from '@/server/auth/page';
export const metadata: Metadata = { title: 'Навыки и грейд - MESHWORK' };
export default async function Page() { await requirePageCandidate('/skills'); return <CandidateSkills />; }
