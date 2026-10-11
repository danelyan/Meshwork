import { Chat } from '@/components/Chat';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { PausedFeed } from '@/components/onboarding/PausedFeed';
import { loadLastChat, type RestoredChat } from '@/server/agent/restore';
import { resolveChatDemoContext } from '@/server/demo/context';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView, onboardingInFeed } from '@/server/onboarding/service';
import type { OnboardingView } from '@/server/onboarding/types';

/**
 * Слитая лента /consultant (онбординг + консультант в одном потоке) как серверный компонент –
 * чтобы сцена с головой (AvatarScene) принимала её как `children`. Данные и логика те же, что в
 * app/(candidate)/consultant/page.tsx; при подмене страницы page.tsx вызывает этот компонент.
 * Guard (requirePageCandidate) остаётся на странице: сюда приходит уже проверенная сессия.
 */
export async function ConsultantFeed({ candidateId, userId, tag = 'consultant' }: { candidateId: string; userId?: string | null; tag?: string }) {
  const demo = await resolveChatDemoContext(candidateId).catch(() => ({ noLlm: false, resume: null }));
  let initial: RestoredChat | undefined;
  try {
    initial = await loadLastChat(candidateId);
  } catch (err) {
    console.warn(`[${tag}] restore failed`, err instanceof Error ? err.message : err);
  }
  let view: OnboardingView | undefined;
  if (userId) {
    try {
      if (await onboardingInFeed(userId)) view = await getView(userId);
    } catch (err) {
      // Сбой онбординга не должен закрывать консультанта: показываем обычный чат.
      console.warn(`[${tag}] onboarding view failed`, err instanceof Error ? err.message : err);
    }
  }
  if (view?.later) return <PausedFeed view={view} demo={demo} restored={initial} />;
  return view ? (
    <OnboardingChat variant="consultant" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo, restored: initial }} />
  ) : (
    <Chat demo={demo} initial={initial} />
  );
}
