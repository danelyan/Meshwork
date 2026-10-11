import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';

/**
 * Путь кандидата по платформе (E-02, «ведёт по платформе»): какие шаги пройдены
 * и какой следующий. Считается кодом по БД, не моделью — модель только
 * озвучивает `nextStep` и предлагает его одной фразой (проактивность без
 * выдумывания состояния).
 *
 * Порядок — решение владельца 11.10 (docs/decisions/0008-two-defenses-and-live-call-slots.md):
 * знакомство → тест → квалифицирующий созвон → проект из ленты → ИИ-защита проекта →
 * ждать приглашение → (приглашение пришло: разобрать) → живая защита → нанят.
 * Резюме и ссылки отдельным шагом не идут: они собираются в знакомстве и консультации;
 * если утверждений нет, перед созвоном консультант предлагает приложить источники
 * (созвон «только когда есть о чём говорить», server/call/readiness.ts).
 * Приглашение без ответа важнее всего остального; найм — финал.
 */
export const JOURNEY_STEPS = ['onboarding', 'test', 'call', 'project', 'ai_defense'] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number] | 'waiting' | 'invitations' | 'live_defense' | 'hired';

/** Подсказка модели: что предложить на каждом шаге и каким инструментом или экраном. */
export const STEP_HINT: Record<JourneyStep, string> = {
  onboarding: 'Знакомство не закончено: предложи дополнить профиль здесь же — кнопка «Дополнить профиль» под чатом (цель, направление, грейд, стек), по одному вопросу. После знакомства первым шагом называй тест.',
  test: 'Категории нет: предложи тест на грейд (get_test_status / recommend_test, экран /test) — категорию даёт только он. Это первый шаг после знакомства.',
  call: 'Тест пройден, квалифицирующего созвона не было: предложи созвон голосом (suggest_call; кнопка «Созвониться» в /consultant) — карта глубины по темам резюме, работодатель увидит её до приглашения. Утверждения из резюме и ссылок подтверждаются тут же, в консультации.',
  project: 'Созвон пройден, проверенного проекта нет: предложи взять проект из ленты на экране /projects (отдельного инструмента нет — дай ссылку), сдать репозиторий и дождаться проверки.',
  ai_defense: 'Проект проверен: следующий шаг — ИИ-защита проекта до приглашения. Она скоро появится, кнопки пока нет: скажи честно, что защита «скоро», ничего не обещай по срокам и предложи пока подождать приглашения.',
  waiting: 'Все шаги, доступные сейчас, пройдены: приглашений пока нет. Скажи, что работодатели находят профиль сами; предложи усилить его (get_gap_map, recommend_tasks) или спроси, чем помочь, одним вопросом.',
  invitations: 'Есть входящее приглашение без ответа: предложи разобрать его (get_invitations → explain_invitation). Принять или отклонить — кнопка кандидата.',
  live_defense: 'Приглашение принято: дальше живая защита проекта с работодателем (обязательна для найма, идёт с записью). Время назначает работодатель слотами; кандидат выбирает слот в /invitations. Инструмента нет — дай ссылку на экран.',
  hired: 'Кандидат нанят: компания отметила найм по принятому приглашению (финальный этап пути, hiredCompany). Поздравь коротко и спроси, чем помочь дальше; профиль больше не показывается в поиске других работодателей.',
};

/** Перед созвоном нет утверждений: прежде чем звать на созвон, нужны источники. */
export const CALL_NO_SOURCES_HINT =
  'Тест пройден, но утверждений для квалифицирующего созвона нет, а созвон открывается, только когда есть о чём говорить. Предложи приложить резюме файлом или ссылку на GitHub (read_upload / fetch_url / fetch_profile → propose_claims), либо рассказать о себе в чате; после этого — созвон (suggest_call).';

/** Подсказка с учётом состояния: шаг «созвон» без источников — другой текст. */
export function stepHint(state: Pick<JourneyState, 'nextStep' | 'callNeedsSources'>): string {
  return state.nextStep === 'call' && state.callNeedsSources ? CALL_NO_SOURCES_HINT : STEP_HINT[state.nextStep];
}

export interface JourneyState {
  steps: Record<(typeof JOURNEY_STEPS)[number], boolean>;
  counts: { sources: number; proposed: number; confirmed: number; pendingInvitations: number; acceptedInvitations: number };
  hasCategory: boolean;
  /** Утверждений (не отклонённых) нет: созвон не откроется, перед ним нужны источники. */
  callNeedsSources: boolean;
  /** null — у кандидата нет аккаунта входа (старый демо-кандидат) или онбординг неизвестен. */
  onboardedAt: Date | null;
  /** lane hired: компания, отметившая найм; null — найма нет. */
  hired: { company: string; at: string | null } | null;
  nextStep: JourneyStep;
}

export async function journeyState(candidateId: string): Promise<JourneyState> {
  const [user, sources, uploads, byStatus, category, qualifying, project, aiDefense, pending, accepted, hiredInv] = await Promise.all([
    prisma.user.findUnique({ where: { candidateId }, select: { onboardedAt: true } }),
    prisma.source.count({ where: { candidateId } }),
    prisma.upload.count({ where: { candidateId } }),
    prisma.claim.groupBy({ by: ['status'], where: { candidateId }, _count: { _all: true } }),
    prisma.candidateCategory.findFirst({ where: { candidateId }, select: { id: true } }),
    prisma.callSession.count({ where: { candidateId, kind: 'qualifying', status: 'finished' } }),
    prisma.projectSubmission.count({ where: { candidateId, status: 'checked', resultJson: { not: Prisma.DbNull } } }),
    // ИИ-защита до приглашения (lane/ai-defense): завершённая защита сабмита, на который работодатель не звал.
    // Пока таких сессий нет, запрос даёт 0, шаг не пройден.
    prisma.callSession.count({ where: { candidateId, kind: 'defense', status: 'finished', projectSubmissionId: { not: null }, projectSubmission: { defenseInvitationId: null } } }),
    prisma.invitation.count({ where: { candidateId, status: { in: ['sent', 'viewed'] } } }),
    prisma.invitation.count({ where: { candidateId, status: 'accepted' } }),
    prisma.invitation.findFirst({ where: { candidateId, status: 'hired' }, orderBy: { hiredAt: 'desc' }, select: { hiredAt: true, company: { select: { name: true } }, vacancy: { select: { company: { select: { name: true } } } } } }),
  ]);
  const hired = hiredInv ? { company: hiredInv.company?.name ?? hiredInv.vacancy?.company.name ?? 'Компания', at: hiredInv.hiredAt?.toISOString() ?? null } : null;
  const n = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const confirmed = n('confirmed') + n('edited');
  const proposed = n('proposed');
  const steps = {
    // Без аккаунта входа (демо-кандидат из сида) анкету не требуем.
    onboarding: user ? user.onboardedAt !== null : true,
    test: Boolean(category),
    call: qualifying > 0,
    project: project > 0,
    ai_defense: aiDefense > 0,
  };
  const firstOpen = JOURNEY_STEPS.find((s) => !steps[s]);
  const next: JourneyStep = hired ? 'hired' : pending > 0 ? 'invitations' : accepted > 0 ? 'live_defense' : (firstOpen ?? 'waiting');
  return {
    steps,
    counts: { sources: sources + uploads, proposed, confirmed, pendingInvitations: pending, acceptedInvitations: accepted },
    hasCategory: Boolean(category),
    callNeedsSources: confirmed + proposed === 0,
    onboardedAt: user?.onboardedAt ?? null,
    hired,
    nextStep: next,
  };
}
