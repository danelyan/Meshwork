import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DemoScreen } from '@/components/DemoScreen';
import { getEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Демо для жюри — ФСП Карьера', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Список демо-аккаунтов. Только при DEMO_LOGIN=true; иначе 404. */
export default function DemoPage() {
  if (!getEnv().DEMO_LOGIN) notFound();
  return (
    <main id="main">
      <DemoScreen />
    </main>
  );
}
