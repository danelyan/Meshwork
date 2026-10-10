import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { type EmployerRestoredChat, loadLastEmployerChat } from '@/server/agent/employer/restore';
import { requirePageUser } from '@/server/auth/page';
import { chatDemoContextFromCookies } from '@/server/demo/context';
import { llmIsDemoStub } from '@/server/demo/mode';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView } from '@/server/onboarding/service';

export const metadata: Metadata = { title: 'Знакомство - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/**
 * Кандидат проходит онбординг на /consultant (решение владельца 10.10: одна страница) — сюда
 * попадает только по старым ссылкам и сразу уходит туда. Здесь остаются аккаунты без роли
 * (согласие и выбор роли; выбрав «специалиста», клиент переходит на /consultant) и работодатели.
 *
 * Онбординг-чат на весь экран (E-02, решения владельца 09.10): лента помощника, вопросы по одному,
 * любой можно пропустить, «Настроить позже» — в шапке. После итога та же лента продолжается
 * карьерным консультантом (кандидат) или помощником по подбору (работодатель). Guard — нужен аккаунт (любая роль). API — app/api/onboarding/route.ts.
 */
export default async function OnboardingPage() {
  const s = await requirePageUser('/onboarding');
  if (s.candidateId) redirect('/consultant');
  const view = await getView(s.userId);
  const demo = await chatDemoContextFromCookies();
  // Работодатель: после итога лента продолжается помощником по подбору (решение владельца 09.10).
  let employerRestored: EmployerRestoredChat | undefined;
  if (s.employerProfileId && view.onboarded && view.current.kind === 'summary') {
    try {
      employerRestored = await loadLastEmployerChat(s.employerProfileId);
    } catch (err) {
      console.warn('[onboarding] restore employer chat failed', err instanceof Error ? err.message : err);
    }
  }
  return (
    <OnboardingChat
      initial={view}
      consentText={[...CONSENT_PARAGRAPHS]}
      consultant={{ demo }}
      employerAssistant={{ demoNoLlm: llmIsDemoStub(), restored: employerRestored }}
    />
  );
}
