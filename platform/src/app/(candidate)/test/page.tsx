import type { Metadata } from 'next';
import { Suspense } from 'react';

import { TestPage } from '@/components/TestPage';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Тест на грейд — ФСП Карьера' };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** /test?specialization=&grade=&attempt= — вход из онбординга и профиля (ADR-0002). Guard — только кандидат. */
export default async function Page({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  const q = qs.toString();
  await requirePageCandidate(q ? `/test?${q}` : '/test');
  return (
    <Suspense fallback={null}>
      <TestPage />
    </Suspense>
  );
}
