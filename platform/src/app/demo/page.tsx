import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DemoScreen } from '@/components/DemoScreen';
import { safeNext } from '@/server/auth/redirect';
import { getEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Демо для жюри - ФСП Карьера', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Список демо-аккаунтов. Только при DEMO_LOGIN=true; иначе 404. `?next=` — только относительный путь (safeNext). */
export default async function DemoPage({ searchParams }: { searchParams: Search }) {
  if (!getEnv().DEMO_LOGIN) notFound();
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  return (
    <main id="main">
      <DemoScreen next={next} />
    </main>
  );
}
