import type { Metadata } from 'next';
import { CareerPage } from '@/components/candidate/CareerPage';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Избранное - ФСП Карьера' };

export default async function Page() {
  await requirePageCandidate('/saved');
  return <CareerPage savedOnly />;
}
