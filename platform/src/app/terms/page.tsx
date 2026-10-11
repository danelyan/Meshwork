import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { TERMS } from '@/lib/legal/terms';

export const metadata: Metadata = { title: `${TERMS.title} - MESHWORK` };

export default function Page() {
  return <LegalDocument doc={TERMS} />;
}
