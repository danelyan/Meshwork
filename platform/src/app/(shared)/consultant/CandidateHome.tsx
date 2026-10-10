import { AvatarScene } from '@/components/avatar/AvatarScene';
import { Chat } from '@/components/Chat';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { PausedFeed } from '@/components/onboarding/PausedFeed';
import { loadLastChat, type RestoredChat } from '@/server/agent/restore';
import { resolveChatDemoContext } from '@/server/demo/context';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import type { OnboardingView } from '@/server/onboarding/types';
import { loadCandidateAside } from '@/server/consultant/aside';

import { warn } from './warn';
import { COMPANION_NAME } from '@/lib/persona';

const CANDIDATE_LABEL = `${COMPANION_NAME} · ИИ-консультант`;

/**
 * Дом кандидата на /consultant: шаги знакомства, после итога та же лента — консультант; «Настроить позже» —
 * пауза: шаги остаются началом ленты, дальше свободный разговор (PausedFeed). Аккаунт, завершённый без
 * чата (сид демо), — обычный чат. Данные работодателя не читает.
 */
export async function CandidateHome({ candidateId, view }: { candidateId: string; view: OnboardingView | undefined }) {
  const demo = await resolveChatDemoContext(candidateId).catch(() => ({ noLlm: false, resume: null }));
  const initial: RestoredChat | undefined = (await loadLastChat(candidateId).catch(warn('restore'))) ?? undefined;
  let feed;
  if (!view) feed = <Chat demo={demo} initial={initial} />;
  else if (view.later) feed = <PausedFeed view={view} demo={demo} restored={initial} />;
  else feed = <OnboardingChat variant="consultant" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo, restored: initial }} />;
  const aside = await loadCandidateAside(candidateId, view).catch(warn('candidate aside'));
  // Режим звонка (ADR 0003, ступень 1) — только у кандидата: кнопка «Созвониться» и предложение агента.
  return (
    <AvatarScene variant="call-side" label={CANDIDATE_LABEL} aside={aside ?? undefined} call>
      {feed}
    </AvatarScene>
  );
}
