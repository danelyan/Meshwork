import type { Metadata } from 'next';

import { DefenseDialog } from '@/components/DefenseDialog';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Защита утверждения — ФСП Карьера' };

export default async function DefensePage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  await requirePageCandidate(`/defense/${encodeURIComponent(claimId)}`);
  return <DefenseDialog claimId={claimId} />;
}
