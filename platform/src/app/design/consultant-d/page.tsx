import type { Metadata } from 'next';

import { ConsultantSceneVariantPage } from '../consultant-scene-page';

export const metadata: Metadata = { title: 'Консультант d - Звонок и чат слева', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Тестовый вариант d (C + A): тёмный экран звонка и панель чата слева. Guard как у /consultant. */
export default function Page() {
  return <ConsultantSceneVariantPage path="/design/consultant-d" variant="call-side" />;
}
