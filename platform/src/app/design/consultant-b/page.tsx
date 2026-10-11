import type { Metadata } from 'next';

import { ConsultantSceneVariantPage } from '../consultant-scene-page';

export const metadata: Metadata = { title: 'Консультант b - Голова в ленте', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Тестовый вариант b экрана консультанта с нашей головой. Guard как у /consultant. */
export default function Page() {
  return <ConsultantSceneVariantPage path="/design/consultant-b" variant="inline" />;
}
