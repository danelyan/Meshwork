import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import { getEnv } from '@/server/env';
import { SESSION_COOKIE, parseSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'MESHWORK - не ищи работу, пусть найдут тебя',
  description: 'Профиль с доказательствами навыков, адаптивный тест и приглашения с зарплатной вилкой. ИИ-консультант для специалиста и работодателя.',
};

export default async function HomePage() {
  // parseSession, а не verifySession: та видит только кандидата, и работодатель или аккаунт без роли получали
  // гостевые «Приступим» и «Войти» (модалка входа поверх входа). Без БД: протухшую куку отсеет гвард /consultant.
  const signedIn = parseSession((await cookies()).get(SESSION_COOKIE)?.value) !== null;
  // Реальные логотипы на графе и отдельная демонстрационная лента из экспорта.
  // Ссылка «Для жюри» (lane jury-all) — только при DEMO_LOGIN.
  return <Landing data={SHOWCASE} signedIn={signedIn} demoEnabled={getEnv().DEMO_LOGIN} />;
}
