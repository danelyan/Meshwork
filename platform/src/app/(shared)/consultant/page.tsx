import type { Metadata } from 'next';

import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import { requirePageAccount } from '@/server/auth/page';
import { chatDemoContextFromCookies } from '@/server/demo/context';
import { CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';
import { getView, onboardingInFeed } from '@/server/onboarding/service';
import type { OnboardingView } from '@/server/onboarding/types';

import { CandidateHome } from './CandidateHome';
import { EmployerHome } from './EmployerHome';
import { warn } from './warn';

export const metadata: Metadata = { title: 'Консультант - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Знакомство кандидата имеет отдельную сцену; завершённый или отложенный опрос открывает обычный чат. Ветка работодателя определяется активной ролью сессии. */
export default async function ConsultantPage({ searchParams }: { searchParams?: Promise<{ edit?: string | string[]; call?: string | string[]; mode?: string | string[] }> } = {}) {
  const s = await requirePageAccount('/consultant');
  // The field is selected by the authenticated goto API before navigation. This flag
  // only renders that saved step; it never resets completed onboarding or changes roles.
  const query = await searchParams;
  const editProfile = s.role === 'candidate' && query?.edit === 'profile';
  const intakePreview = s.role === 'candidate' && query?.mode === 'intake';
  // ?call=1 — открыть режим созвона сразу (ссылка со страницы /interview).
  const openCall = query?.call === '1';
  let view: OnboardingView | undefined;
  let viewFailed = false;
  if (s.userId) {
    try {
      if (editProfile || intakePreview || await onboardingInFeed(s.userId)) view = await getView(s.userId);
    } catch (err) {
      viewFailed = true;
      warn('onboarding view')(err);
    }
  }

  // Ветка по активной роли (`s.role`), id профиля — второе условие: с переключением ролей в куке будут
  // обе id, и пускать по наличию id нельзя. Данные чужой роли не грузятся.
  if (s.role === 'employer' && s.employerProfileId) return <EmployerHome employerProfileId={s.employerProfileId} view={view} />;
  if (s.role === 'candidate' && s.candidateId) return <CandidateHome candidateId={s.candidateId} view={view} openCall={openCall} intakePreview={intakePreview} />;

  // Роль не выбрана: согласие и выбор роли. Онбординг недоступен — показать нечего, честная ошибка.
  if (!view) throw new Error(viewFailed ? 'onboarding unavailable' : 'no onboarding for account without role');
  return (
    <OnboardingChat variant="intake" initial={view} consentText={[...CONSENT_PARAGRAPHS]} consultant={{ demo: await chatDemoContextFromCookies() }} />
  );
}
