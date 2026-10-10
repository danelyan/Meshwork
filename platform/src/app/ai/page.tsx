import type { Metadata } from 'next';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { AI_DOC } from '@/lib/legal/ai';

export const metadata: Metadata = { title: `${AI_DOC.title} - ФСП Карьера` };

export default function Page() {
  return <LegalDocument doc={AI_DOC} />;
}
