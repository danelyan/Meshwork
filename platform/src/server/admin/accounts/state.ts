import type { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';

/**
 * Состояние модерации аккаунтов (E-08, фаза 3), которое читают сервисы платформы: вход, подборка, приглашения,
 * тест. Без `server-only`: модуль берут `auth/stale.ts` и `auth/users.ts`, а их — консольные прогоны вне Next.js.
 *
 * Блокировка — флаг с причиной и сроком (`blockedAt`, `blockedUntil`; null — бессрочно). Действует, пока
 * `blockedAt` задан и срок не прошёл. Разблокировка ставит `blockedUntil = now` и `blockedAt` не стирает: он —
 * эпоха отзыва сессий (`sessionVersionOf`). Поэтому «заблокирован ли сейчас» решает только `isBlockedNow`,
 * а не `blockedAt != null`.
 *
 * Скрытие кандидата модератором и сброс кулдауна хранятся в журнале `AdminAuditLog` (только INSERT, индекс
 * targetType+targetId): последняя строка действия — текущее состояние. Поля схемы для них не заводили.
 */

export interface BlockFields {
  blockedAt: Date | null;
  blockedUntil: Date | null;
}

export function isBlockedNow(x: BlockFields | null | undefined, now: Date = new Date()): boolean {
  if (!x?.blockedAt) return false;
  return x.blockedUntil === null || x.blockedUntil > now;
}

/** Условие Prisma «блокировка действует» для User и Company. */
export function activeBlockWhere(now: Date = new Date()) {
  return { blockedAt: { not: null }, OR: [{ blockedUntil: null }, { blockedUntil: { gt: now } }] } satisfies Prisma.UserWhereInput & Prisma.CompanyWhereInput;
}

/**
 * Кандидат без действующей блокировки аккаунта. Кандидат без аккаунта (старые демо) проходит: `NOT` над
 * условием на отсутствующую связь истинно. Класть в `AND`, чтобы не перетереть соседний `NOT`.
 */
export function notBlockedCandidateWhere(now: Date = new Date()): Prisma.CandidateWhereInput {
  return { NOT: { user: { is: activeBlockWhere(now) } } };
}

/** Вакансия компании без действующей блокировки (скрыта у кандидатов). */
export function notBlockedVacancyWhere(now: Date = new Date()): Prisma.VacancyWhereInput {
  return { company: { NOT: activeBlockWhere(now) } };
}

/** Сообщение заблокированному при входе: без причины модерации (она внутренняя), со сроком. */
export function blockedMessage(x: BlockFields): string {
  const until = x.blockedUntil ? ` до ${x.blockedUntil.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} МСК` : '';
  return `Аккаунт заблокирован модератором${until}. Если это ошибка — напишите в поддержку.`;
}

export function userBlockedError(x: BlockFields): AppError {
  return new AppError('account_blocked', blockedMessage(x), 403);
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Проверка «компания заблокирована модератором» для отправки приглашения. Вызывать внутри транзакции
 * `createInvitation` (под advisory-lock компании): блокировка, поставленная до коммита вставки, её остановит.
 */
export async function assertCompanyNotBlocked(db: Db, companyId: string, now: Date = new Date()): Promise<void> {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { blockedAt: true, blockedUntil: true } });
  if (isBlockedNow(c, now)) {
    throw new AppError('company_blocked', 'Отправка приглашений закрыта: компания заблокирована модератором платформы. Напишите в поддержку.', 403, { by: 'moderator' });
  }
}

export const HIDE_CANDIDATE_ACTIONS = ['hide_candidate.hidden', 'hide_candidate.shown'] as const;

/** Профиль скрыт модератором (последнее решение — «скрыть»): сам кандидат его не возвращает в поиск. */
export async function isHiddenByModerator(candidateId: string, db: Db = prisma): Promise<boolean> {
  const last = await db.adminAuditLog.findFirst({
    where: { targetType: 'candidate', targetId: candidateId, action: { in: [...HIDE_CANDIDATE_ACTIONS] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { action: true },
  });
  return last?.action === 'hide_candidate.hidden';
}

/**
 * Когда поддержка последний раз сбросила кулдауны кандидата (R-C-09) или null. Интервалы, начавшиеся до этого
 * момента (подтверждение категории, прошлая попытка), в допуске к тесту не учитываются; категорию сброс не меняет.
 */
export async function cooldownResetAt(candidateId: string, db: Db = prisma): Promise<Date | null> {
  const last = await db.adminAuditLog.findFirst({
    where: { targetType: 'candidate', targetId: candidateId, action: 'reset_cooldown' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}

/** Ключ PlatformSetting: показывать ли демо-кандидатов в подборке и поиске работодателей. Умолчание — да. */
export const SHOW_DEMO_SETTING = 'matching.show_demo_candidates';

export async function showDemoInMatching(db: Db = prisma): Promise<boolean> {
  const row = await db.platformSetting.findUnique({ where: { key: SHOW_DEMO_SETTING }, select: { value: true } });
  return row ? row.value !== false : true;
}
