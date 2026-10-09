import type { Metadata } from 'next';

import { ProfilePage } from '@/components/ProfilePage';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Профиль - ФСП Карьера' };

export default async function Page() {
  await requirePageCandidate('/profile');
  return <ProfilePage />;
}
