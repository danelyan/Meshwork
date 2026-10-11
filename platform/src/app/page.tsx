import type { Metadata } from 'next';

import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import { getPageSession } from '@/server/auth/page';

export const metadata: Metadata = {
  title: 'ФСП Карьера - твой код, твоя карьера',
  description: 'ИТ-подбор с обратной механикой: покажи навыки и достижения - получай предложения от компаний с открытой зарплатной вилкой.',
};

export default async function HomePage() {
  // Та же проверка, что у шапки: verifySession видит только кандидата, и работодатель или аккаунт без роли
  // получали на главной гостевые «Приступим» и «Войти», открывавшие модалку входа поверх входа.
  const signedIn = (await getPageSession()) !== null;
  // Публичные примеры ИТ-компаний; чужие вакансии не импортируются.
  return <Landing data={SHOWCASE} signedIn={signedIn} />;
}
