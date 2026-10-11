import type { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { type ActiveRole, type HeaderAccount, planRoleSwitch, swapRoleOnboarding } from './role-plan';
import { type UserWithProfiles, createCandidateProfile, createEmployerProfile, withProfiles } from './users';

/**
 * Переключение роли на одной учётке (ADR 0004). `User.role` – активная роль: с ней выпускается кука при
 * следующем входе. Вторая роль – второй профиль (Candidate или EmployerProfile + Company) на той же учётке,
 * создаётся при первом переходе; её знакомство идёт в ленте /consultant (согласие уже есть – не спрашиваем).
 * После вызова перевыпусти куку: `userSessionCookie(sessionInputFor(user))` – в ней id профиля только
 * активной роли (`parseSession`).
 */

export type RoleSwitchRequest = { role: 'candidate' } | { role: 'employer'; companyName?: string };

export interface RoleSwitchResult {
  user: UserWithProfiles;
  /** Профиль роли создан этим вызовом (запущено знакомство второй роли). */
  created: boolean;
  /** Роль сменилась (false – уже была активна, вызов идемпотентен). */
  changed: boolean;
}

/** Аккаунт – общий демо из сида: `isDemo` без своего входа (у «Нового пользователя» с /demo есть вход `demo`). */
function isSharedDemo(user: { isDemo: boolean; accounts: { provider: string }[] }): boolean {
  return user.isDemo && !user.accounts.some((a) => a.provider === 'demo');
}

type Json = Record<string, unknown>;

/** Роли с завершённым знакомством, кроме активной: `OnboardingState.meta.doneRoles` (служебное поле состояния знакомства). */
function doneRolesOf(meta: unknown): ActiveRole[] {
  const raw = (meta as Json | null)?.doneRoles;
  return Array.isArray(raw) ? raw.filter((r): r is ActiveRole => r === 'candidate' || r === 'employer') : [];
}

/** Перенос шага, паузы и итога между ролями (`swapRoleOnboarding`) и запись `doneRoles`. */
async function saveOnboardingState(
  tx: Prisma.TransactionClient,
  userId: string,
  st: { stepId: string | null; lines: unknown; meta: unknown } | null,
  from: ActiveRole,
  to: ActiveRole,
  opts: { fresh: boolean; doneRoles: ActiveRole[] },
): Promise<void> {
  const next = swapRoleOnboarding(
    { stepId: st?.stepId ?? null, lines: (st?.lines as Json | null) ?? {}, meta: (st?.meta as Json | null) ?? {} },
    from,
    to,
    opts,
  );
  const data = { stepId: next.stepId, lines: next.lines as Prisma.InputJsonValue, meta: next.meta as Prisma.InputJsonValue };
  await tx.onboardingState.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export async function switchRole(userId: string, request: RoleSwitchRequest): Promise<RoleSwitchResult> {
  return prisma.$transaction(async (tx) => {
    // Два одновременных перехода одной учётки (двойной клик, две вкладки) идут по очереди: иначе оба создали бы
    // профиль. Блокировка строки аккаунта до конца транзакции; параметр – через шаблон, без интерполяции.
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { ...withProfiles, accounts: { select: { provider: true } }, onboarding: { select: { stepId: true, lines: true, meta: true } } },
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
    // planRoleSwitch отказал pending раньше, здесь user.role – активная роль.
    await saveOnboardingState(tx, userId, onboarding, user.role as ActiveRole, target, {
      fresh: plan.kind === 'create',
      doneRoles: plan.onboardedRoles,
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { role: target, candidateId, onboardedAt: plan.targetOnboarded ? new Date() : null },
      include: withProfiles,
    });
    return { user: updated, created: plan.kind === 'create', changed: true };
  });
}

/** Кнопка аккаунта в шапке (`HeaderAccount`): имя, почта и, если роль выбрана, меню ролей. */
export async function headerAccountFor(userId: string | null, role: string): Promise<HeaderAccount | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      isDemo: true,
      candidateId: true,
      accounts: { select: { provider: true } },
      employerProfile: { select: { company: { select: { name: true } } } },
    },
  });
  if (!user) return null;
  const account = { userName: user.name, userEmail: user.email };
  if (role !== 'candidate' && role !== 'employer') return { ...account, roles: null };
  const other: ActiveRole = role === 'candidate' ? 'employer' : 'candidate';
  const otherExists = other === 'candidate' ? user.candidateId !== null : user.employerProfile !== null;
  return {
    ...account,
    roles: {
      role,
      companyName: user.employerProfile?.company.name ?? null,
      other,
      otherExists,
      canCreateOther: !otherExists && !isSharedDemo(user),
    },
  };
}
