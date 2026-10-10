import type { Metadata } from 'next';

import { AvatarScene } from '@/components/avatar/AvatarScene';
import { Chat } from '@/components/Chat';
import { loadCandidateAside, loadEmployerAside } from '@/server/consultant/aside';
import { AssistantChat } from '@/components/employer/AssistantChat';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { PausedFeed } from '@/components/onboarding/PausedFeed';
import { type EmployerRestoredChat, loadLastEmployerChat } from '@/server/agent/employer/restore';
import { loadLastChat, type RestoredChat } from '@/server/agent/restore';
import { requirePageAccount } from '@/server/auth/page';
import { chatDemoContextFromCookies, resolveChatDemoContext } from '@/server/demo/context';
import { llmIsDemoStub } from '@/server/demo/mode';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView, onboardingInFeed } from '@/server/onboarding/service';
import type { OnboardingView } from '@/server/onboarding/types';

export const metadata: Metadata = { title: 'Консультант - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Подпись у головы: у работодателя - помощник по подбору, у кандидата и без роли - консультант. */
const CANDIDATE_LABEL = 'ИИ-консультант';
const EMPLOYER_LABEL = 'Помощник по подбору';

const warn = (what: string) => (err: unknown) => console.warn(`[consultant] ${what} failed`, err instanceof Error ? err.message : err);

/**
 * Один адрес с чатом (решения владельца 10.10). Гость → /auth?next=/consultant; дальше по роли:
 *  - роль не выбрана — лента знакомства (согласие, роль); после выбора роли страница перерисуется;
 *  - кандидат — шаги знакомства, после итога та же лента — консультант; «Настроить позже» — пауза:
 *    шаги остаются началом ленты, дальше свободный разговор (PausedFeed). Аккаунт, завершённый без
 *    чата (сид демо), — обычный чат;
 *  - работодатель — его знакомство в той же ленте, после итога — помощник по подбору; «Настроить позже» —
 *    та же пауза (PausedFeed с помощником); завершённый
 *    без чата — сразу помощник (дом работодателя — чат). Данные кандидата — только при candidateId из куки.
 * Сцена - «звонок + чат слева» (AvatarScene call-side, решение владельца 10.10); ConsultantScene Карины не используется.
 * История — шаги (OnboardingState) + разговор (loadLastChat), сшиваются на клиенте.
 */
export default async function ConsultantPage() {
  const s = await requirePageAccount('/consultant');
  let view: OnboardingView | undefined;
  let viewFailed = false;
  if (s.userId) {
    try {
      if (await onboardingInFeed(s.userId)) view = await getView(s.userId);
    } catch (err) {
      viewFailed = true;
      warn('onboarding view')(err);
    }
  }

  // Работодатель: дом — эта лента с помощником по подбору (решение владельца 10.10). Знакомство не
  // завершено или пройдено в чате — шаги и помощник после итога; завершено без чата (сид демо) или
  // онбординг недоступен — сразу помощник. Подбор (/employer) — по навигации и ссылкам из чата.
  if (s.employerProfileId && !s.candidateId) {
    const demoNoLlm = llmIsDemoStub();
    // Разговор грузим всегда: после итога он продолжение ленты, на паузе - её чат, посреди шагов -
    // реплики прежних пауз под своими шагами.
    const employerRestored: EmployerRestoredChat | undefined = (await loadLastEmployerChat(s.employerProfileId).catch(warn('employer restore'))) ?? undefined;
    const aside = await loadEmployerAside(s.employerProfileId, view).catch(warn('employer aside'));
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

  // Роль не выбрана: согласие и выбор роли. Онбординг недоступен — показать нечего, честная ошибка.
  if (!s.candidateId) {
    if (!view) throw new Error(viewFailed ? 'onboarding unavailable' : 'no onboarding for account without role');
    return (
      <AvatarScene variant="call-side" label={CANDIDATE_LABEL}>
        <OnboardingChat variant="consultant" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo: await chatDemoContextFromCookies() }} />
      </AvatarScene>
    );
  }

  const demo = await resolveChatDemoContext(s.candidateId).catch(() => ({ noLlm: false, resume: null }));
  const initial: RestoredChat | undefined = (await loadLastChat(s.candidateId).catch(warn('restore'))) ?? undefined;
  let feed;
  if (!view) feed = <Chat demo={demo} initial={initial} />;
  else if (view.later) feed = <PausedFeed view={view} demo={demo} restored={initial} />;
  else feed = <OnboardingChat variant="consultant" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo, restored: initial }} />;
  const aside = await loadCandidateAside(s.candidateId, view).catch(warn('candidate aside'));
  return (
    <AvatarScene variant="call-side" label={CANDIDATE_LABEL} aside={aside ?? undefined}>
      {feed}
    </AvatarScene>
  );
}
