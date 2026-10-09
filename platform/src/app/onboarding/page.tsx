import type { Metadata } from 'next';

import { requirePageUser } from '@/server/auth/page';

export const metadata: Metadata = { title: 'Онбординг — ФСП Карьера' };
export const dynamic = 'force-dynamic';

/**
 * Заглушка: онбординг-чат делает лейн B. Guard — нужен аккаунт (любая роль).
 * Контракт: GET /api/auth/me, POST /api/auth/consent, POST /api/auth/role,
 * POST /api/auth/onboarding/complete (docs/decisions/0001-auth-yandex-id.md).
 */
export default async function OnboardingPage() {
  const s = await requirePageUser('/onboarding');
  return (
    <main id="main" style={{ maxWidth: 720, margin: '0 auto', padding: '56px var(--page-pad)' }}>
      <h1>Онбординг</h1>
      <p>Здесь будет онбординг-чат: выбор роли и согласие на обработку данных.</p>
      <p style={{ color: 'var(--muted)' }}>Текущая роль: {s.role}</p>
    </main>
  );
}
