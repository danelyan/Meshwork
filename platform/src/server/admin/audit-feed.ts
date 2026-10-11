import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';

export interface AuditFilter {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  /** id последней строки предыдущей страницы */
  cursor?: string;
  limit?: number;
}

/** Лента журнала (новые сверху) с именем сотрудника. Только чтение – журнал не правится. */
export async function listAudit(f: AuditFilter) {
  const take = f.limit ?? 50;
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.targetType ? { targetType: f.targetType } : {}),
    ...(f.targetId ? { targetId: f.targetId } : {}),
  };
  const rows = await prisma.adminAuditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  const ids = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = ids.length ? await prisma.staffMember.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } }) : [];
  const byId = new Map(actors.map((a) => [a.id, a]));
  return {
    items: page.map((r) => ({ ...r, actor: r.actorId ? (byId.get(r.actorId) ?? null) : null })),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
  };
}
