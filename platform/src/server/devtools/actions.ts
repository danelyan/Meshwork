import { prisma } from '@/server/db';
import { SHARED_DEMO_USER, createFreshDemoUser, sessionInputFor } from '@/server/auth/users';
import { errors } from '@/server/errors';
import type { SessionPrincipal } from '@/server/session';

/** Действия дебаг-панели (только localhost, гейт — guard.ts). Работают над пользователем из сессии. */

export type DevSession = SessionPrincipal & { userId: string };

/**
 * Новый пустой разговор активной роли (`s.role`; ADR 0004 — у учётки могут быть оба профиля); старые остаются,
 * новый становится последним (его открывает страница).
 */
export async function startNewConversation(s: SessionPrincipal): Promise<{ conversationId: string; next: string }> {
  if (s.role === 'candidate' && s.candidateId) {
    const c = await prisma.conversation.create({ data: { candidateId: s.candidateId }, select: { id: true } });
    return { conversationId: c.id, next: '/consultant' };
  }
  if (s.role === 'employer' && s.employerProfileId) {
    const c = await prisma.employerConversation.create({ data: { employerProfileId: s.employerProfileId }, select: { id: true } });
    return { conversationId: c.id, next: '/consultant' };
  }
  throw errors.conflict('Роль не выбрана: разговор начать негде');
}

/**
 * Сбросить онбординг активной роли: состояние чата и `onboardedAt`; с `alsoProfile` - ещё и ответы профиля этой
 * роли. Профиль второй роли не трогаем: в куке только id профиля активной роли (`parseSession`).
 */
export async function clearOnboarding(s: DevSession, alsoProfile: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const state = await tx.onboardingState.findUnique({ where: { userId: s.userId }, select: { meta: true } });
    await tx.onboardingState.deleteMany({ where: { userId: s.userId } });
    await tx.user.update({ where: { id: s.userId }, data: { onboardedAt: null } });
    if (!alsoProfile) return;
    if (s.role === 'candidate' && s.candidateId) {
      await tx.candidateProfile.deleteMany({ where: { candidateId: s.candidateId } });
      await tx.candidate.update({ where: { id: s.candidateId }, data: { specialization: null } });
    }
    if (s.role === 'employer' && s.employerProfileId) {
      const profile = await tx.employerProfile.findUnique({ where: { id: s.employerProfileId }, select: { companyId: true } });
      if (profile) {
        await tx.company.update({
          where: { id: profile.companyId },
          data: { description: null, inn: null, industry: null, contact: null },
        });
        const vacancies = (state?.meta as { vacancies?: Record<string, string> } | null)?.vacancies ?? {};
        const ids = Object.values(vacancies).filter((v): v is string => typeof v === 'string');
        if (ids.length) await tx.vacancy.deleteMany({ where: { id: { in: ids }, companyId: profile.companyId } });
      }
    }
  });
}

/**
 * Удалить аккаунт и всё его — оба профиля, если учётка переключала роль (ids берём из БД, не из куки). Кандидат: Candidate (каскадом - категории, загрузки, утверждения,
 * разговоры, попытки теста, приглашения, защита, анкета) и его AgentRun. Работодатель: приглашения,
 * разговоры помощника, профиль; компания с вакансиями - если в ней больше никого нет. Всё в одной транзакции.
 */
export async function deleteAccount(s: SessionPrincipal): Promise<void> {
  await prisma.$transaction(async (tx) => {
    let candidateId = s.candidateId;
    let employerProfileId = s.employerProfileId;
    if (s.userId) {
      const user = await tx.user.findUnique({
        where: { id: s.userId },
        select: { candidateId: true, employerProfile: { select: { id: true, companyId: true } } },
      });
      candidateId = user?.candidateId ?? candidateId;
      employerProfileId = user?.employerProfile?.id ?? employerProfileId;
    }
    if (candidateId) {
      await tx.agentRun.deleteMany({ where: { candidateId } });
      await tx.candidate.deleteMany({ where: { id: candidateId } });
    }
    if (employerProfileId) {
      const profile = await tx.employerProfile.findUnique({ where: { id: employerProfileId }, select: { companyId: true } });
      await tx.invitation.deleteMany({ where: { employerProfileId } });
      await tx.employerProfile.deleteMany({ where: { id: employerProfileId } });
      if (profile) {
        const others = await tx.employerProfile.count({ where: { companyId: profile.companyId } });
        if (others === 0) await tx.company.deleteMany({ where: { id: profile.companyId } });
      }
    }
    if (s.userId) await tx.user.deleteMany({ where: { id: s.userId } });
  });
}

/** Удалить попытки теста кандидата (интервалы пересдачи мешают проверке). Возвращает число удалённых. */
export async function resetTestAttempts(s: SessionPrincipal): Promise<number> {
  if (s.role !== 'candidate' || !s.candidateId) throw errors.forbidden('Доступно только кандидату');
  const r = await prisma.testAttempt.deleteMany({ where: { candidateId: s.candidateId } });
  return r.count;
}

/** Новый демо-гость (как «Новый пользователь» на /demo); без версии согласия не создаётся. */
export async function newFreshUser(consent: string | null | undefined) {
  const user = await createFreshDemoUser(consent);
  return { user, session: sessionInputFor(user), next: '/consultant' };
}

/** Демо-аккаунты для переключателя «Войти как…». */
export async function listDemoAccounts() {
  const candidates = await prisma.candidate.findMany({
    where: { isDemo: true },
    select: { id: true, name: true, specialization: true },
    orderBy: { createdAt: 'asc' },
  });
  const employers = await prisma.user.findMany({
    where: { ...SHARED_DEMO_USER, role: 'employer', employerProfile: { isNot: null } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  return { candidates, employers };
}
