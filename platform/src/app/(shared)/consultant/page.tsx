import type { Metadata } from 'next';

import { AvatarScene } from '@/components/avatar/AvatarScene';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { requirePageAccount } from '@/server/auth/page';
import { chatDemoContextFromCookies } from '@/server/demo/context';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView, onboardingInFeed } from '@/server/onboarding/service';
import type { OnboardingView } from '@/server/onboarding/types';

import { CandidateHome } from './CandidateHome';
import { EmployerHome } from './EmployerHome';
import { warn } from './warn';
import { COMPANION_NAME } from '@/lib/persona';

export const metadata: Metadata = { title: 'Консультант - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Подпись у головы без роли - консультант (у ролей - в CandidateHome / EmployerHome). */
const CANDIDATE_LABEL = `${COMPANION_NAME} · ИИ-консультант`;

/**
 * Один адрес с чатом (решения владельца 10.10). Гость → /auth?next=/consultant; дальше по роли:
 *  - роль не выбрана — лента знакомства (согласие, роль); после выбора роли страница перерисуется;
 *  - кандидат — шаги знакомства, после итога та же лента — консультант; «Настроить позже» — пауза:
 *    шаги остаются началом ленты, дальше свободный разговор (PausedFeed). Аккаунт, завершённый без
 *    чата (сид демо), — обычный чат;
 *  - работодатель — его знакомство в той же ленте, после итога — помощник по подбору; «Настроить позже» —
 *    та же пауза (PausedFeed с помощником); завершённый
 *    без чата — сразу помощник (дом работодателя — чат). Ветвление - по активной роли `session.role`; ветки - серверные компоненты EmployerHome / CandidateHome.
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

  // Ветка по активной роли (`s.role`), id профиля — второе условие: с переключением ролей в куке будут
  // обе id, и пускать по наличию id нельзя. Данные чужой роли не грузятся.
  if (s.role === 'employer' && s.employerProfileId) return <EmployerHome employerProfileId={s.employerProfileId} view={view} />;
  if (s.role === 'candidate' && s.candidateId) return <CandidateHome candidateId={s.candidateId} view={view} />;

  // Роль не выбрана: согласие и выбор роли. Онбординг недоступен — показать нечего, честная ошибка.
  if (!view) throw new Error(viewFailed ? 'onboarding unavailable' : 'no onboarding for account without role');
  return (
    <AvatarScene variant="call-side" label={CANDIDATE_LABEL}>
      <OnboardingChat variant="consultant" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo: await chatDemoContextFromCookies() }} />
    </AvatarScene>
  );
}
