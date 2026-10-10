import { errors } from '@/server/errors';
import type { SessionRole } from '@/server/session';

/**
 * Переключение роли на одной учётке (ADR 0004) — чистое решение без БД: что сделать и как пересчитать
 * отметки знакомства. Исполняет `switchRole` (role-switch.ts) в транзакции.
 */

export type ActiveRole = 'candidate' | 'employer';
export const ACTIVE_ROLES: readonly ActiveRole[] = ['candidate', 'employer'];

export interface RoleSwitchState {
  role: SessionRole;
  onboardedAt: Date | null;
  onboardedRoles: readonly SessionRole[];
  hasCandidate: boolean;
  hasEmployer: boolean;
  /** Общий демо-аккаунт из сида (им входят все члены жюри): вторую роль на нём не создаём. */
  sharedDemo: boolean;
}

export type RoleSwitchPlan =
  /** Роль уже активна — ничего не меняем (идемпотентно), только перевыпуск куки. */
  | { kind: 'same' }
  | {
      /** activate — профиль целевой роли есть; create — создать его в той же транзакции. */
      kind: 'activate' | 'create';
      /** Роли с завершённым знакомством — новое `OnboardingState.meta.doneRoles`. */
      onboardedRoles: ActiveRole[];
      /** Знакомство целевой роли уже завершено: `onboardedAt` ставится, иначе обнуляется и лента начнёт её шаги. */
      targetOnboarded: boolean;
    };

/** Есть ли у учётки профиль роли. */
export function hasProfile(s: Pick<RoleSwitchState, 'hasCandidate' | 'hasEmployer'>, role: ActiveRole): boolean {
  return role === 'candidate' ? s.hasCandidate : s.hasEmployer;
}

/**
 * Решение по запросу «перейти в роль `target`». `onboardedAt` относится к активной роли, `onboardedRoles` (`meta.doneRoles`) —
 * к остальным: уходя из роли, записываем, завершено ли её знакомство сейчас (сброс знакомства дебаг-панелью
 * или демо тоже учитывается), а для целевой роли берём отметку из списка.
 * Ошибки: роль не выбрана — 409 (первая роль выбирается в знакомстве); вторая роль на общем демо-аккаунте — 403;
 * работодатель без названия компании, когда профиль надо создать, — 400.
 */
export function planRoleSwitch(state: RoleSwitchState, target: ActiveRole, opts: { companyName?: string | null } = {}): RoleSwitchPlan {
  if (state.role === 'pending') throw errors.conflict('Сначала выберите роль в знакомстве');
  if (state.role === target) return { kind: 'same' };
  const create = !hasProfile(state, target);
  if (create && state.sharedDemo) {
    throw errors.forbidden('На общем демо-аккаунте вторую роль не создать: войдите как «Новый пользователь» на странице /demo');
  }
  if (create && target === 'employer' && !opts.companyName?.trim()) {
    throw errors.badRequest('Укажите название компании');
  }
  const done = new Set<ActiveRole>(state.onboardedRoles.filter((r): r is ActiveRole => r !== state.role && r !== 'pending'));
  if (state.onboardedAt) done.add(state.role);
  return {
    kind: create ? 'create' : 'activate',
    onboardedRoles: ACTIVE_ROLES.filter((r) => done.has(r)),
    targetOnboarded: !create && done.has(target),
  };
}

/** Роли в меню аккаунта: активная, компания работодателя и куда можно перейти. */
export interface RoleMenu {
  role: ActiveRole;
  /** Название компании работодателя (есть профиль работодателя — даже когда активна роль кандидата); иначе null. */
  companyName: string | null;
  other: ActiveRole;
  /** Профиль второй роли уже есть — «Перейти в режим…»; нет — «Стать…» (если можно создать). */
  otherExists: boolean;
  /** Вторую роль можно создать (нет на общем демо-аккаунте). */
  canCreateOther: boolean;
}

/**
 * Кнопка аккаунта в шапке (`headerAccountFor`): имя и почта есть у любого вошедшего; `roles` — только когда роль
 * выбрана (у `pending` null: в меню лишь имя, почта и «Выйти», роль выбирают на знакомстве).
 */
export interface HeaderAccount {
  userName: string;
  userEmail: string | null;
  roles: RoleMenu | null;
}

type Json = Record<string, unknown>;

/** Состояние знакомства одной роли, пока она неактивна: шаг, пауза «Настроить позже», реплика итога. */
export interface RoleOnboardingStash {
  stepId: string | null;
  later?: true;
  summary?: string;
}

/** Часть `OnboardingState`, которую меняет переход. */
export interface OnboardingSlice {
  stepId: string | null;
  lines: Json;
  meta: Json;
}

/**
 * Состояние знакомства у учётки одно (`OnboardingState`), а шаг, пауза и итог — свои у каждой роли: id шага `summary`
 * общий для сценариев, пауза `meta.later` — флаг без роли. При переходе прячем их у уходящей роли в
 * `meta.byRole[<роль>]` и достаём у целевой; новая роль (`fresh`) начинает с первого шага без паузы и итога.
 * Ответы (`answers`) не трогаем: шаги ролей не пересекаются. `doneRoles` — роли с завершённым знакомством.
 */
export function swapRoleOnboarding(
  st: OnboardingSlice,
  from: ActiveRole,
  to: ActiveRole,
  opts: { fresh: boolean; doneRoles: ActiveRole[] },
): OnboardingSlice {
  const meta: Json = { ...st.meta };
  const lines: Json = { ...st.lines };
  const byRole: Partial<Record<ActiveRole, RoleOnboardingStash>> = { ...((meta.byRole as Json | undefined) ?? {}) };

  const leaving: RoleOnboardingStash = { stepId: st.stepId };
  if (meta.later === true) leaving.later = true;
  if (typeof lines.summary === 'string') leaving.summary = lines.summary;
  byRole[from] = leaving;

  const restore: RoleOnboardingStash = opts.fresh ? { stepId: null } : (byRole[to] ?? { stepId: null });
  delete byRole[to];
  delete meta.later;
  delete lines.summary;
  if (restore.later) meta.later = true;
  if (restore.summary !== undefined) lines.summary = restore.summary;
  meta.byRole = byRole;
  meta.doneRoles = opts.doneRoles;
  return { stepId: restore.stepId, lines, meta };
}
