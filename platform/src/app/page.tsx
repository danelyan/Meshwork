import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import { getEnv } from '@/server/env';
import { SESSION_COOKIE, parseSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'ФСП Карьера - твой код, твоя карьера',
  description: 'ИТ-подбор с обратной механикой: покажи навыки и достижения - получай предложения от компаний с открытой зарплатной вилкой.',
};

export default async function HomePage() {
  // parseSession, а не verifySession: та видит только кандидата, и работодатель или аккаунт без роли получали
  // гостевые «Приступим» и «Войти» (модалка входа поверх входа). Без БД: протухшую куку отсеет гвард /consultant.
  const signedIn = parseSession((await cookies()).get(SESSION_COOKIE)?.value) !== null;
  // Публичные примеры ИТ-компаний; чужие вакансии не импортируются.
  return <Landing data={SHOWCASE} signedIn={signedIn} demoEnabled={getEnv().DEMO_LOGIN} />;
}
