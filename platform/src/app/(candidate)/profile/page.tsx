import type { Metadata } from 'next';

import { ProfilePage } from '@/components/ProfilePage';

export const metadata: Metadata = { title: 'Профиль — ФСП Карьера' };

export default function Page() {
  return <ProfilePage />;
}
