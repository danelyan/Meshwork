import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { type AuditAction, DEMO_READONLY_MESSAGE, can } from './permissions';
import type { StaffContext } from './session';

/**
 * Журнал действий персонала (ADR 0009, принцип 3 E-08): только INSERT. Строки не правятся и не удаляются –
 * в коде нет update/delete модели, в БД – триггер `AdminAuditLog_immutable`.
 *
 * Вызов внутри транзакции действия – тогда строка журнала и само действие коммитятся или откатываются вместе:
 *
 *   await prisma.$transaction(async (tx) => {
 *     const before = await tx.complaint.findUniqueOrThrow({ where: { id } });
 *     const after = await tx.complaint.update({ where: { id }, data: { status: 'dismissed', … } });
 *     await audit({ actor: staff, action: 'resolve_complaint.dismissed', target: { type: 'complaint', id }, reason, before, after }, tx);
 *   });
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditTarget {
  /** user | candidate | company | vacancy | invitation | complaint | appeal | objection | red_flag | setting | staff | … */
  type: string;
  id: string;
}

export interface AuditInput {
  /** Сотрудник (`requireStaff`/`requirePageStaff`); null – системное действие (CLI). */
  actor: Pick<StaffContext, 'staffId' | 'ip'> | null;
  action: AuditAction;
  target?: AuditTarget | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (v === undefined) return undefined;
  if (v === null) return Prisma.JsonNull;
  // Date, Decimal и т.п. – в JSON как при ответе API.
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export async function audit(input: AuditInput, db: Db = prisma): Promise<{ id: string }> {
  return db.adminAuditLog.create({
    data: {
      actorId: input.actor?.staffId ?? null,
      ip: input.actor?.ip ?? null,
      action: input.action,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      reason: input.reason?.trim() || null,
      before: json(input.before),
      after: json(input.after),
    },
    select: { id: true },
  });
}

export const REASON_MIN = 5;
export const REASON_MAX = 1000;

/** Причина обязательна (решения модерации, раскрытие ПДн, блокировки): 400, если пусто или короче REASON_MIN. */
export function requireReason(reason: string | null | undefined): string {
  const r = reason?.trim() ?? '';
  if (r.length < REASON_MIN) throw errors.badRequest(`Укажите причину (не короче ${REASON_MIN} символов)`);
  if (r.length > REASON_MAX) throw errors.badRequest('Причина слишком длинная');
  return r;
}

export interface RevealInput {
  actor: StaffContext;
  target: AuditTarget;
  reason: string | null | undefined;
  /** Какие поля раскрыты: ['email', 'phone', 'name'] – пишутся в журнал (значения – нет). */
  fields: string[];
}

/**
 * Раскрыть ПДн (принцип 4 E-08): право `reveal_pii`, обязательная причина, строка журнала до чтения данных.
 * `load` читает сами данные – его результат возвращается вызывающему и в журнал не попадает.
 *
 *   const pii = await revealPii({ actor: staff, target: { type: 'candidate', id }, reason, fields: ['email', 'phone'] },
 *     () => prisma.candidate.findUniqueOrThrow({ where: { id }, select: { email: true, phone: true } }));
 */
export async function revealPii<T>(input: RevealInput, load: () => Promise<T>): Promise<T> {
  if (!can(input.actor.role, 'reveal_pii')) throw errors.forbidden('Недостаточно прав');
  if (input.actor.demo) throw errors.forbidden(DEMO_READONLY_MESSAGE);
  const reason = requireReason(input.reason);
  await audit({ actor: input.actor, action: 'reveal_pii', target: input.target, reason, after: { fields: input.fields } });
  return load();
}
