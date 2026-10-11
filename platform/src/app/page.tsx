import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import { SESSION_COOKIE, parseSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'MESHWORK - твой код, твоя карьера | ФСП Карьера',
  description: 'Профиль с доказательствами навыков, адаптивный тест и приглашения с зарплатной вилкой. ИИ-консультант для специалиста и работодателя.',
};

export default async function HomePage() {
  // parseSession, а не verifySession: та видит только кандидата, и работодатель или аккаунт без роли получали
  // гостевые «Приступим» и «Войти» (модалка входа поверх входа). Без БД: протухшую куку отсеет гвард /consultant.
  const signedIn = parseSession((await cookies()).get(SESSION_COOKIE)?.value) !== null;
  // Реальные логотипы на графе и отдельная демонстрационная лента из экспорта.
  return <Landing data={SHOWCASE} signedIn={signedIn} />;
}
