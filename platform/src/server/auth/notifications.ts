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
    const items = rows.map((r) => ({ id: r.id, text: `Приглашение от ${r.company?.name ?? 'компании'}`, detail: `${r.vacancy?.title ?? 'Предложение'} · ${r.salaryFrom.toLocaleString('ru-RU')}-${r.salaryTo.toLocaleString('ru-RU')} ₽`, href: '/invitations', at: r.createdAt.toISOString(), unread: r.createdAt > read }));
    // lane invite-cancel: компания отозвала приглашение — отдельное уведомление со временем отзыва и причиной.
    const ww = { candidateId: s.candidateId, withdrawnAt: { not: null, lte: through } };
    const [wRows, wUnread] = await Promise.all([
      prisma.invitation.findMany({ where: ww, orderBy: { withdrawnAt: 'desc' }, take: 20, select: { id: true, withdrawnAt: true, withdrawReason: true, company: { select: { name: true } } } }),
      prisma.invitation.count({ where: { candidateId: s.candidateId, withdrawnAt: { gt: read, lte: through } } }),
    ]);
    const withdrawn = wRows.map((r) => ({ id: `withdrawn-${r.id}`, text: `«${r.company?.name ?? 'Компания'}» отозвала приглашение`, detail: (r.withdrawReason ?? '').slice(0, 120), href: '/invitations', at: r.withdrawnAt!.toISOString(), unread: r.withdrawnAt! > read }));
    return merge([...items, ...withdrawn], unread + wUnread, await liveEvents({ candidateId: s.candidateId, audience: 'candidate' }, read, through, '/invitations'), through);
  }
  if (s.role === 'employer' && s.employerProfileId) {
    const read = user.employerNotificationsReadAt ?? new Date(0);
    const where = { employerProfileId: s.employerProfileId, respondedAt: { not: null, lte: through } };
    const [rows, unread] = await Promise.all([
      prisma.invitation.findMany({ where, orderBy: { respondedAt: 'desc' }, take: 20, select: { id: true, respondedAt: true, status: true, vacancy: { select: { title: true } } } }),
      prisma.invitation.count({ where: { ...where, respondedAt: { gt: read, lte: through } } }),
    ]);
    const items = rows.map((r) => ({ id: r.id, text: r.status === 'declined' ? 'Кандидат отклонил приглашение' : 'Кандидат принял приглашение', detail: r.vacancy?.title ?? 'Приглашение без вакансии', href: '/employer/invitations', at: r.respondedAt!.toISOString(), unread: r.respondedAt! > read }));
    const profile = await prisma.employerProfile.findUnique({ where: { id: s.employerProfileId }, select: { companyId: true } });
    const live = profile ? await liveEvents({ companyId: profile.companyId, audience: 'employer' }, read, through, '/employer/invitations') : { items: [], unread: 0 };
    return merge(items, unread, live, through);
  }
  return { items: [], unread: 0, through: through.toISOString() };
}

/** lane live-slots (ADR 0008 п. 3–4, 6): события живой защиты — предложены слоты, выбрано время, не подошло, отмена. */
async function liveEvents(where: { candidateId: string; audience: 'candidate' } | { companyId: string; audience: 'employer' }, read: Date, through: Date, href: string) {
  const w = { ...where, createdAt: { lte: through } };
  const [rows, unread] = await Promise.all([
    prisma.liveDefenseEvent.findMany({ where: w, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, text: true, detail: true, createdAt: true } }),
    prisma.liveDefenseEvent.count({ where: { ...where, createdAt: { gt: read, lte: through } } }),
  ]);
  return { unread, items: rows.map((r) => ({ id: `live-${r.id}`, text: r.text, detail: r.detail, href, at: r.createdAt.toISOString(), unread: r.createdAt > read })) };
}

function merge(items: NotificationItem[], unread: number, live: { items: NotificationItem[]; unread: number }, through: Date): NotificationFeed {
  const all = [...items, ...live.items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 20);
  return { through: through.toISOString(), unread: unread + live.unread, items: all };
}

export async function markNotificationsRead(s: SessionPrincipal & { userId: string }, through: Date) {
  if (through > new Date()) throw errors.badRequest('Нельзя отметить будущие уведомления');
  const field = s.role === 'candidate' ? 'candidateNotificationsReadAt' : s.role === 'employer' ? 'employerNotificationsReadAt' : null;
  if (!field) return;
  // Never move the cursor backwards when two devices acknowledge concurrently.
  await prisma.user.updateMany({ where: { id: s.userId, role: s.role, OR: [{ [field]: null }, { [field]: { lt: through } }] }, data: { [field]: through } });
}
