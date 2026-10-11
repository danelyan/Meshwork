import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { EMPLOYER_TERMS } from '@/lib/legal/employer-terms';

export const metadata: Metadata = { title: `${EMPLOYER_TERMS.title} - MESHWORK` };

export default function Page() {
  return <LegalDocument doc={EMPLOYER_TERMS} />;
}
