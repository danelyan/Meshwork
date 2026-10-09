import type { Metadata } from 'next';

import { AvatarPreview } from './AvatarPreview';

export const metadata: Metadata = { title: 'Аватар компаньона — превью', robots: { index: false } };

// Dev-страница (не в навигации): крупная голова-сетка и знак-фоллбэк, ползунок рта — для настройки вида и записи питча.
export default function AvatarPreviewPage() {
  return <AvatarPreview />;
}
