import type { Metadata } from 'next';

import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { requirePageUser } from '@/server/auth/page';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView } from '@/server/onboarding/service';

export const metadata: Metadata = { title: 'Знакомство — ФСП Карьера' };
export const dynamic = 'force-dynamic';

/**
 * Онбординг-чат на весь экран (E-02, решение владельца 09.10): помощник задаёт
 * вопросы по одному, любой можно пропустить, «Настроить позже» — в шапке.
 * Guard — нужен аккаунт (любая роль). API — app/api/onboarding/route.ts.
 */
export default async function OnboardingPage() {
  const s = await requirePageUser('/onboarding');
  const view = await getView(s.userId);
  return <OnboardingChat initial={view} consentText={[...CONSENT_PARAGRAPHS]} />;
}
