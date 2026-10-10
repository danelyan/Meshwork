import { AvatarScene } from '@/components/avatar/AvatarScene';
import { AssistantChat } from '@/components/employer/AssistantChat';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { PausedFeed } from '@/components/onboarding/PausedFeed';
import { type EmployerRestoredChat, loadLastEmployerChat } from '@/server/agent/employer/restore';
import { llmIsDemoStub } from '@/server/demo/mode';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import type { OnboardingView } from '@/server/onboarding/types';
import { loadEmployerAside } from '@/server/consultant/aside';

import { warn } from './warn';

const EMPLOYER_LABEL = 'Помощник по подбору';

/**
 * Дом работодателя на /consultant: лента с помощником по подбору (решение владельца 10.10). Знакомство не
 * завершено или пройдено в чате — шаги и помощник после итога; завершено без чата (сид демо) или
 * онбординг недоступен — сразу помощник. Подбор (/employer) — по навигации и ссылкам из чата.
 * Данные кандидата не читает.
 */
export async function EmployerHome({ employerProfileId, view }: { employerProfileId: string; view: OnboardingView | undefined }) {
  const demoNoLlm = llmIsDemoStub();
  // Разговор грузим всегда: после итога он продолжение ленты, на паузе - её чат, посреди шагов -
  // реплики прежних пауз под своими шагами.
  const employerRestored: EmployerRestoredChat | undefined = (await loadLastEmployerChat(employerProfileId).catch(warn('employer restore'))) ?? undefined;
  const aside = await loadEmployerAside(employerProfileId, view).catch(warn('employer aside'));
  return (
    <AvatarScene variant="call-side" label={EMPLOYER_LABEL} aside={aside ?? undefined}>
      {view?.later ? (
        <PausedFeed view={view} employer={{ demoNoLlm, restored: employerRestored }} />
      ) : view ? (
        <OnboardingChat variant="consultant" initial={view} consentText={[...CONSENT_PARAGRAPHS]} employerAssistant={{ demoNoLlm, restored: employerRestored }} />
      ) : (
        <AssistantChat initial={employerRestored} demoNoLlm={demoNoLlm} />
      )}
    </AvatarScene>
  );
}
