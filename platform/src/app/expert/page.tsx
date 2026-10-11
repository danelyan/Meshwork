import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ExpertTest } from '@/components/expert/ExpertTest';
import { getEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Режим эксперта - ФСП Карьера', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Режим эксперта: тест на грейд без регистрации, грейд не присваивается. Только при DEMO_LOGIN=true; иначе 404. */
export default function ExpertPage() {
  if (!getEnv().DEMO_LOGIN) notFound();
  return (
    <main id="main">
      <ExpertTest />
    </main>
  );
}
