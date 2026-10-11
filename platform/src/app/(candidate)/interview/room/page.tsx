import type { Metadata } from 'next';

import { InterviewRoom } from '@/components/interview/InterviewRoom';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Созвон с ИИ: комната - MESHWORK' };

/** /interview/room – комната звонка ИИнтервью с перебиванием голосом (docs/competency-model.md § 4.1). Guard – только кандидат. */
export default async function Page() {
  await requirePageCandidate('/interview/room');
  return <InterviewRoom />;
}
