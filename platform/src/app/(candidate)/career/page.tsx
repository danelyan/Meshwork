import type { Metadata } from 'next';
import { CareerPage } from '@/components/candidate/CareerPage';
import { requirePageCandidate } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Вакансии - ФСП Карьера' };

export default async function Page() {
  await requirePageCandidate('/career');
  return <CareerPage />;
}
