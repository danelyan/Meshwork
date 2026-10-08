import type { Metadata } from 'next';

import { DefenseDialog } from '@/components/DefenseDialog';

export const metadata: Metadata = { title: 'Защита утверждения — ФСП Карьера' };

export default async function DefensePage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  return <DefenseDialog claimId={claimId} />;
}
