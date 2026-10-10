import type { Metadata } from 'next';

import { ConsultantSceneVariantPage } from '../consultant-scene-page';

export const metadata: Metadata = { title: 'Консультант a - Портрет-собеседник', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Тестовый вариант a экрана консультанта с нашей головой (docs/research/23). Guard как у /consultant. */
export default function Page() {
  return <ConsultantSceneVariantPage path="/design/consultant-a" variant="portrait" />;
}
