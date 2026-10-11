import type { Metadata } from 'next';

import { InterviewPage } from '@/components/interview/InterviewPage';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Созвон с ИИ - MESHWORK' };

/** /interview — ИИнтервью по модели компетенций (docs/competency-model.md). Guard — только кандидат. */
export default async function Page() {
  await requirePageCandidate('/interview');
  return <InterviewPage />;
}
