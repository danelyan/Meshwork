import 'server-only';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { revealPii } from '../audit';
import type { StaffContext } from '../session';

/**
 * Раскрытие ПДн в карточках (принцип 4 E-08): только через `revealPii` — право `reveal_pii`, обязательная
 * причина, строка журнала записывается до чтения. В журнал попадают имена полей, не значения.
 * Существование объекта проверяется до раскрытия: на несуществующий id журнал не пишем.
 */

export async function revealCandidatePii(actor: StaffContext, id: string, reason: string | null | undefined) {
  if (!(await prisma.candidate.findUnique({ where: { id }, select: { id: true } }))) throw errors.notFound('Кандидат не найден');
  return revealPii({ actor, target: { type: 'candidate', id }, reason, fields: ['name', 'email', 'contact'] }, async () => {
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id }, select: { name: true, email: true, contact: true } });
    return { name: c.name, email: c.email, contact: c.contact };
  });
}

export async function revealUserPii(actor: StaffContext, id: string, reason: string | null | undefined) {
  if (!(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw errors.notFound('Пользователь не найден');
  return revealPii({ actor, target: { type: 'user', id }, reason, fields: ['name', 'email'] }, async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id }, select: { name: true, email: true } });
    return { name: u.name, email: u.email };
  });
}

/** Контакт компании и ФИО/почты её представителей. */
export async function revealCompanyPii(actor: StaffContext, id: string, reason: string | null | undefined) {
  if (!(await prisma.company.findUnique({ where: { id }, select: { id: true } }))) throw errors.notFound('Компания не найдена');
  return revealPii({ actor, target: { type: 'company', id }, reason, fields: ['contact', 'representatives.name', 'representatives.email'] }, async () => {
    const c = await prisma.company.findUniqueOrThrow({ where: { id }, select: { contact: true, employers: { orderBy: { createdAt: 'asc' }, select: { id: true, user: { select: { name: true, email: true } } } } } });
    return { contact: c.contact, representatives: c.employers.map((e) => ({ id: e.id, name: e.user.name, email: e.user.email })) };
  });
}
