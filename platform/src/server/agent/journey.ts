import { prisma } from '@/server/db';

/**
 * Путь кандидата по платформе (E-02, «ведёт по платформе»): какие шаги пройдены
 * и какой следующий. Считается кодом по БД, не моделью — модель только
 * озвучивает `nextStep` и предлагает его одной фразой (проактивность без
 * выдумывания состояния).
 *
 * Порядок шагов — сценарий консультанта (docs/career-consultant.md § «Сценарии»):
 * анкета → документы → подтвердить карточки → тест → вакансии → защита.
 * Входящее приглашение важнее всего остального: на него ждут ответа.
 */
export const JOURNEY_STEPS = ['onboarding', 'documents', 'confirm_claims', 'test', 'vacancies', 'defense'] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number] | 'invitations' | 'done';

/** Подсказка модели: что предложить на каждом шаге и каким инструментом. */
export const STEP_HINT: Record<JourneyStep, string> = {
  onboarding: 'Анкета онбординга не закончена: предложи продолжить знакомство здесь же — кнопка «Вернуться к знакомству» вверху ленты (цель, направление, грейд, стек) — это 2–3 минуты.',
  documents: 'Источников нет: попроси резюме файлом или ссылку на GitHub — из них соберём карточки утверждений с цитатами.',
  confirm_claims: 'Есть неподтверждённые карточки: попроси просмотреть и подтвердить их — без подтверждения нет подбора вакансий.',
  test: 'Категории нет: предложи тест (get_test_status / recommend_test) — категорию даёт только он.',
  vacancies: 'Предложи посмотреть вакансии платформы с объяснением покрытия (recommend_targets).',
  defense: 'Предложи поднять уровень ключевого утверждения: защита в чате или задание (explain_evidence → start_verification).',
  invitations: 'Есть входящее приглашение без ответа: предложи разобрать его (get_invitations → explain_invitation). Принять или отклонить — кнопка кандидата.',
  done: 'Основные шаги пройдены: спроси, чем помочь дальше, одним вопросом.',
};

export interface JourneyState {
  steps: Record<(typeof JOURNEY_STEPS)[number], boolean>;
  counts: { sources: number; proposed: number; confirmed: number; pendingInvitations: number; defended: number };
  hasCategory: boolean;
  /** null — у кандидата нет аккаунта входа (старый демо-кандидат) или онбординг неизвестен. */
  onboardedAt: Date | null;
  nextStep: JourneyStep;
}

export async function journeyState(candidateId: string): Promise<JourneyState> {
  const [user, sources, uploads, byStatus, category, targets, defended, pending] = await Promise.all([
    prisma.user.findUnique({ where: { candidateId }, select: { onboardedAt: true } }),
    prisma.source.count({ where: { candidateId } }),
    prisma.upload.count({ where: { candidateId } }),
    prisma.claim.groupBy({ by: ['status'], where: { candidateId }, _count: { _all: true } }),
    prisma.candidateCategory.findFirst({ where: { candidateId }, select: { id: true } }),
    prisma.recommendation.count({ where: { candidateId, kind: 'target' } }),
    prisma.defenseSession.count({ where: { candidateId, status: 'completed' } }),
    prisma.invitation.count({ where: { candidateId, status: 'sent' } }),
  ]);
  const n = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const confirmed = n('confirmed') + n('edited');
  const proposed = n('proposed');
  const steps = {
    // Без аккаунта входа (демо-кандидат из сида) анкету не требуем.
    onboarding: user ? user.onboardedAt !== null : true,
    documents: sources + uploads > 0 || confirmed + proposed > 0,
    confirm_claims: confirmed > 0 && proposed === 0,
    test: Boolean(category),
    vacancies: targets > 0,
    defense: defended > 0,
  };
  const firstOpen = JOURNEY_STEPS.find((s) => !steps[s]);
  // Подтверждённые есть, но висят новые черновики — это не блокер для теста и вакансий.
  const next: JourneyStep =
    pending > 0 ? 'invitations' : firstOpen === 'confirm_claims' && confirmed > 0 ? (JOURNEY_STEPS.slice(3).find((s) => !steps[s]) ?? 'confirm_claims') : (firstOpen ?? 'done');
  return {
    steps,
    counts: { sources: sources + uploads, proposed, confirmed, pendingInvitations: pending, defended },
    hasCategory: Boolean(category),
    onboardedAt: user?.onboardedAt ?? null,
    nextStep: next,
  };
}
