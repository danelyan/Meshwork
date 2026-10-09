import type { Metadata } from 'next';
import { Suspense } from 'react';

import { TestPage } from '@/components/TestPage';

export const metadata: Metadata = { title: 'Тест на грейд — ФСП Карьера' };

/** /test?specialization=&grade=&attempt= — вход из онбординга и профиля (ADR-0002). */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <TestPage />
    </Suspense>
  );
}
