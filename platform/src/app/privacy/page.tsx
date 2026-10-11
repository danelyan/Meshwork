import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { PRIVACY } from '@/lib/legal/privacy';

export const metadata: Metadata = { title: `${PRIVACY.title} - MESHWORK` };

export default function Page() {
  return <LegalDocument doc={PRIVACY} />;
}
