import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import { SESSION_COOKIE, verifySession } from '@/server/session';

export const metadata: Metadata = {
  title: 'ФСП Карьера - твой код, твоя карьера',
  description: 'ИТ-подбор с обратной механикой: покажи навыки и достижения - получай предложения от компаний с открытой зарплатной вилкой.',
};

export default async function HomePage() {
  const jar = await cookies();
  const signedIn = verifySession(jar.get(SESSION_COOKIE)?.value) !== null;
  // Публичные примеры ИТ-компаний; чужие вакансии не импортируются.
  return <Landing data={SHOWCASE} signedIn={signedIn} />;
}
