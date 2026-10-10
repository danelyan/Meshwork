import type { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { type ActiveRole, type RoleMenu, planRoleSwitch } from './role-plan';
import { type UserWithProfiles, createCandidateProfile, createEmployerProfile, withProfiles } from './users';

/**
 * Переключение роли на одной учётке (ADR 0004). `User.role` — активная роль: с ней выпускается кука при
 * следующем входе. Вторая роль — второй профиль (Candidate или EmployerProfile + Company) на той же учётке,
 * создаётся при первом переходе; её знакомство идёт в ленте /consultant (согласие уже есть — не спрашиваем).
 * После вызова перевыпусти куку: `userSessionCookie(sessionInputFor(user))` — в ней id профиля только
 * активной роли (`parseSession`).
 */

export type RoleSwitchRequest = { role: 'candidate' } | { role: 'employer'; companyName?: string };

export interface RoleSwitchResult {
  user: UserWithProfiles;
  /** Профиль роли создан этим вызовом (запущено знакомство второй роли). */
  created: boolean;
  /** Роль сменилась (false — уже была активна, вызов идемпотентен). */
  changed: boolean;
}

/** Аккаунт — общий демо из сида: `isDemo` без своего входа (у «Нового пользователя» с /demo есть вход `demo`). */
function isSharedDemo(user: { isDemo: boolean; accounts: { provider: string }[] }): boolean {
  return user.isDemo && !user.accounts.some((a) => a.provider === 'demo');
}

type Json = Record<string, unknown>;

/** Роли с завершённым знакомством, кроме активной: `OnboardingState.meta.doneRoles` (служебное поле состояния знакомства). */
function doneRolesOf(meta: unknown): ActiveRole[] {
  const raw = (meta as Json | null)?.doneRoles;
  return Array.isArray(raw) ? raw.filter((r): r is ActiveRole => r === 'candidate' || r === 'employer') : [];
}

/**
 * Состояние знакомства после перехода. Всегда — новое `meta.doneRoles`. Новая роль (`create`) начинает знакомство
 * с первого своего шага: снимаем текущий шаг, паузу «Настроить позже» и реплику итога прежней роли. Ответы не
 * трогаем: шаги ролей не пересекаются, ответы прежней роли понадобятся, если вернуться к ней.
 */
async function saveOnboardingState(
  tx: Prisma.TransactionClient,
  userId: string,
  st: { lines: unknown; meta: unknown } | null,
  doneRoles: ActiveRole[],
  fresh: boolean,
): Promise<void> {
  const meta: Json = { ...((st?.meta as Json | null) ?? {}), doneRoles };
  if (!fresh) {
    await tx.onboardingState.upsert({
      where: { userId },
      create: { userId, meta: meta as Prisma.InputJsonValue },
      update: { meta: meta as Prisma.InputJsonValue },
    });
    return;
  }
  delete meta.later;
  const lines: Json = { ...((st?.lines as Json | null) ?? {}) };
  delete lines.summary;
  const data = { stepId: null, lines: lines as Prisma.InputJsonValue, meta: meta as Prisma.InputJsonValue };
  await tx.onboardingState.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export async function switchRole(userId: string, request: RoleSwitchRequest): Promise<RoleSwitchResult> {
  return prisma.$transaction(async (tx) => {
    // Два одновременных перехода одной учётки (двойной клик, две вкладки) идут по очереди: иначе оба создали бы
    // профиль. Блокировка строки аккаунта до конца транзакции; параметр — через шаблон, без интерполяции.
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { ...withProfiles, accounts: { select: { provider: true } }, onboarding: { select: { lines: true, meta: true } } },
    });
    if (!user) throw errors.notFound('Аккаунт не найден');
    const target: ActiveRole = request.role;
    const companyName = request.role === 'employer' ? request.companyName : undefined;
    const plan = planRoleSwitch(
      {
        role: user.role,
        onboardedAt: user.onboardedAt,
        onboardedRoles: doneRolesOf(user.onboarding?.meta),
        hasCandidate: user.candidateId !== null,
        hasEmployer: user.employerProfile !== null,
        sharedDemo: isSharedDemo(user),
      },
      target,
      { companyName },
    );
    const { accounts: _accounts, onboarding, ...plain } = user;
    void _accounts;
    if (plan.kind === 'same') return { user: plain, created: false, changed: false };

    let candidateId = user.candidateId;
    if (plan.kind === 'create') {
      if (target === 'candidate') candidateId = await createCandidateProfile(tx, user);
      else await createEmployerProfile(tx, userId, companyName!.trim());
    }
    await saveOnboardingState(tx, userId, onboarding, plan.onboardedRoles, plan.kind === 'create');
    const updated = await tx.user.update({
      where: { id: userId },
      data: { role: target, candidateId, onboardedAt: plan.targetOnboarded ? new Date() : null },
      include: withProfiles,
    });
    return { user: updated, created: plan.kind === 'create', changed: true };
  });
}

/** Меню роли для шапки (`RoleMenu`). */
export async function roleMenuFor(userId: string | null, role: string): Promise<RoleMenu | null> {
  if (!userId || (role !== 'candidate' && role !== 'employer')) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isDemo: true,
      candidateId: true,
      accounts: { select: { provider: true } },
      employerProfile: { select: { company: { select: { name: true } } } },
    },
  });
  if (!user) return null;
  const other: ActiveRole = role === 'candidate' ? 'employer' : 'candidate';
  const otherExists = other === 'candidate' ? user.candidateId !== null : user.employerProfile !== null;
  return {
    role,
    companyName: role === 'employer' ? (user.employerProfile?.company.name ?? null) : null,
    other,
    otherExists,
    canCreateOther: !otherExists && !isSharedDemo(user),
  };
}
