import type { Metadata } from 'next';

import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { type EmployerRestoredChat, loadLastEmployerChat } from '@/server/agent/employer/restore';
import { type RestoredChat, loadLastChat } from '@/server/agent/restore';
import { requirePageUser } from '@/server/auth/page';
import { chatDemoContextFromCookies } from '@/server/demo/context';
import { llmIsDemoStub } from '@/server/demo/mode';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView } from '@/server/onboarding/service';

export const metadata: Metadata = { title: 'Знакомство — ФСП Карьера' };
export const dynamic = 'force-dynamic';

/**
 * Онбординг-чат на весь экран (E-02, решения владельца 09.10): лента помощника, вопросы по одному,
 * любой можно пропустить, «Настроить позже» — в шапке. После итога та же лента продолжается
 * карьерным консультантом (кандидат) или помощником по подбору (работодатель). Guard — нужен аккаунт (любая роль). API — app/api/onboarding/route.ts.
 */
export default async function OnboardingPage() {
  const s = await requirePageUser('/onboarding');
  const view = await getView(s.userId);
  const demo = await chatDemoContextFromCookies();
  let restored: RestoredChat | undefined;
  // Кандидат: последний разговор с консультантом — в нём вопросы посреди шагов (под своим шагом)
  // и, если знакомство уже завершено, продолжение ленты после итога. Один чат на всё.
  if (s.candidateId) {
    try {
      restored = await loadLastChat(s.candidateId);
    } catch (err) {
      console.warn('[onboarding] restore chat failed', err instanceof Error ? err.message : err);
    }
  }
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
      consultant={{ demo, restored }}
      employerAssistant={{ demoNoLlm: llmIsDemoStub(), restored: employerRestored }}
    />
  );
}
