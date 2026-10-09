import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { loadLandingData } from '@/components/landing/data';
import { Landing } from '@/components/landing/Landing';
import { SESSION_COOKIE, verifySession } from '@/server/session';

// Данные (компании, вакансии, счётчики) читаются из БД на каждый запрос; сессия — из куки.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ФСП Карьера — твой код, твоя карьера',
  description: 'ИТ-подбор с обратной механикой: покажи навыки и достижения — получай предложения от компаний с открытой зарплатной вилкой.',
};

export default async function HomePage() {
  const jar = await cookies();
  const signedIn = verifySession(jar.get(SESSION_COOKIE)?.value) !== null;
  const data = await loadLandingData();
  return <Landing data={data} signedIn={signedIn} />;
}
