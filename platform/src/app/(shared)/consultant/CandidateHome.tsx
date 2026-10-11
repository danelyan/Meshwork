import { AvatarScene } from '@/components/avatar/AvatarScene';
import { Chat } from '@/components/Chat';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { PausedFeed } from '@/components/onboarding/PausedFeed';
import { loadLastChat, type RestoredChat } from '@/server/agent/restore';
import { resolveChatDemoContext } from '@/server/demo/context';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import type { OnboardingView } from '@/server/onboarding/types';
import { resolveCallKind } from '@/server/interview/context';
import { loadCandidateAside } from '@/server/consultant/aside';

import { warn } from './warn';
import { COMPANION_NAME } from '@/lib/persona';

const CANDIDATE_LABEL = `${COMPANION_NAME} · ИИ-консультант`;

/** Первичный опрос и редактирование поля показывают вопросы, черновик и Киру. После завершения или паузы доступен обычный консультант. */
export async function CandidateHome({ candidateId, view, openCall = false, intakePreview = false }: { candidateId: string; view: OnboardingView | undefined; openCall?: boolean; intakePreview?: boolean }) {
  const demo = await resolveChatDemoContext(candidateId).catch(() => ({ noLlm: false, resume: null }));
  const initial: RestoredChat | undefined = (await loadLastChat(candidateId).catch(warn('restore'))) ?? undefined;
  if (view && !openCall && (intakePreview || (!view.later && (!view.onboarded || view.current.kind !== 'summary')))) {
    return <OnboardingChat variant="intake" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo, restored: initial }} />;
  }
  let feed;
  if (!view) feed = <Chat demo={demo} initial={initial} />;
  else if (view.later) feed = <PausedFeed view={view} demo={demo} restored={initial} />;
  else feed = <Chat demo={demo} initial={initial} />;
  const aside = await loadCandidateAside(candidateId, view).catch(warn('candidate aside'));
  // Режим звонка (ADR 0003, ступень 1) — только у кандидата: кнопка «Созвониться»/«ИИнтервью» и предложение агента.
  // Вид решается тут: после теста на грейд — ИИнтервью, до него — квалифицирующий созвон.
  const callKind = await resolveCallKind(candidateId).catch(() => 'qualifying' as const);
  return (
    <AvatarScene variant="call-side" label={CANDIDATE_LABEL} aside={aside ?? undefined} call callKind={callKind} callOpen={openCall}>
      {feed}
    </AvatarScene>
  );
}
