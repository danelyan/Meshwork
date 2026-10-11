import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import type { SessionPrincipal } from '@/server/session';

export type NotificationItem = { id: string; text: string; detail: string; href: string; at: string; unread: boolean };
export type NotificationFeed = { items: NotificationItem[]; unread: number; through: string };

export async function notifications(s: SessionPrincipal & { userId: string }): Promise<NotificationFeed> {
  const user = await prisma.user.findUnique({ where: { id: s.userId }, select: { role: true, candidateNotificationsReadAt: true, employerNotificationsReadAt: true } });
  if (!user || user.role !== s.role) throw errors.sessionStale();
  const through = new Date();
  if (s.role === 'candidate' && s.candidateId) {
    const read = user.candidateNotificationsReadAt ?? new Date(0);
    const where = { candidateId: s.candidateId, createdAt: { lte: through } };
    const [rows, unread] = await Promise.all([
      prisma.invitation.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, createdAt: true, company: { select: { name: true } }, vacancy: { select: { title: true } }, salaryFrom: true, salaryTo: true } }),
      prisma.invitation.count({ where: { ...where, createdAt: { gt: read, lte: through } } }),
    ]);
    return { through: through.toISOString(), unread, items: rows.map((r) => ({ id: r.id, text: `Приглашение от ${r.company?.name ?? 'компании'}`, detail: `${r.vacancy?.title ?? 'Предложение'} · ${r.salaryFrom.toLocaleString('ru-RU')}-${r.salaryTo.toLocaleString('ru-RU')} ₽`, href: '/invitations', at: r.createdAt.toISOString(), unread: r.createdAt > read })) };
  }
  if (s.role === 'employer' && s.employerProfileId) {
    const read = user.employerNotificationsReadAt ?? new Date(0);
    const where = { employerProfileId: s.employerProfileId, respondedAt: { not: null, lte: through } };
    const [rows, unread] = await Promise.all([
      prisma.invitation.findMany({ where, orderBy: { respondedAt: 'desc' }, take: 20, select: { id: true, respondedAt: true, status: true, vacancy: { select: { title: true } } } }),
      prisma.invitation.count({ where: { ...where, respondedAt: { gt: read, lte: through } } }),
    ]);
    return { through: through.toISOString(), unread, items: rows.map((r) => ({ id: r.id, text: r.status === 'declined' ? 'Кандидат отклонил приглашение' : 'Кандидат принял приглашение', detail: r.vacancy?.title ?? 'Приглашение без вакансии', href: '/employer/invitations', at: r.respondedAt!.toISOString(), unread: r.respondedAt! > read })) };
  }
  return { items: [], unread: 0, through: through.toISOString() };
}

export async function markNotificationsRead(s: SessionPrincipal & { userId: string }, through: Date) {
  if (through > new Date()) throw errors.badRequest('Нельзя отметить будущие уведомления');
  const field = s.role === 'candidate' ? 'candidateNotificationsReadAt' : s.role === 'employer' ? 'employerNotificationsReadAt' : null;
  if (!field) return;
  // Never move the cursor backwards when two devices acknowledge concurrently.
  await prisma.user.updateMany({ where: { id: s.userId, role: s.role, OR: [{ [field]: null }, { [field]: { lt: through } }] }, data: { [field]: through } });
}
