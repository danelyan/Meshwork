import { loadCandidateAside, loadEmployerAside } from '@/server/consultant/aside';
import { errors, withErrors } from '@/server/errors';
import { getView, onboardingInFeed } from '@/server/onboarding/service';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Данные правой колонки экрана консультанта («Твой путь», «Документы», «Подсказка») для текущей
 * роли — те же, что страница отдаёт при загрузке; лента перечитывает их после своих событий.
 * Роль не выбрана — 403 (колонки у такого аккаунта нет).
 */
export const GET = withErrors(async (req: Request) => {
  const s = requireUser(req);
  const view = (await onboardingInFeed(s.userId)) ? await getView(s.userId) : undefined;
  if (s.employerProfileId && !s.candidateId) return Response.json(await loadEmployerAside(s.employerProfileId, view));
  if (s.candidateId) return Response.json(await loadCandidateAside(s.candidateId, view));
  throw errors.forbidden('Колонка доступна после выбора роли');
});
