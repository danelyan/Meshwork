import { markNotificationsRead, notifications } from '@/server/auth/notifications';

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn(), updateMany: vi.fn() }, invitation: { findMany: vi.fn(), count: vi.fn() }, liveDefenseEvent: { findMany: vi.fn(), count: vi.fn() }, application: { findMany: vi.fn(), count: vi.fn() }, employerProfile: { findUnique: vi.fn() } }));
vi.mock('@/server/db', () => ({ prisma: db }));
const candidate = { userId: 'user-c', role: 'candidate' as const, candidateId: 'candidate-c', employerProfileId: null };
const employer = { userId: 'user-e', role: 'employer' as const, candidateId: null, employerProfileId: 'employer-e' };
const now = new Date('2026-10-10T15:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  db.invitation.findMany.mockResolvedValue([]);
  db.invitation.count.mockResolvedValue(0);
  db.liveDefenseEvent.findMany.mockResolvedValue([]);
  db.liveDefenseEvent.count.mockResolvedValue(0);
  db.application.findMany.mockResolvedValue([]);
  db.application.count.mockResolvedValue(0);
  db.employerProfile.findUnique.mockResolvedValue({ companyId: 'co-e' });
});
afterEach(() => vi.useRealTimers());

describe('notification role scopes and read watermarks', () => {
  it('queries only the signed candidate and its own role watermark', async () => {
    const read = new Date('2026-10-10T12:00:00Z');
    db.user.findUnique.mockResolvedValue({ role: 'candidate', candidateNotificationsReadAt: read, employerNotificationsReadAt: now });
    db.invitation.findMany.mockResolvedValueOnce([{ id: 'i1', createdAt: new Date('2026-10-10T14:00:00Z'), company: { name: 'Компания' }, vacancy: null, salaryFrom: 100000, salaryTo: 200000 }]);
    db.invitation.count.mockResolvedValueOnce(1);
    const feed = await notifications(candidate);
    // lane invite-cancel: отозванные приглашения — тоже только свои, по времени отзыва.
    expect(db.invitation.findMany.mock.calls[1]![0].where).toEqual({ candidateId: 'candidate-c', withdrawnAt: { not: null, lte: now } });
    expect(db.invitation.count.mock.calls[1]![0].where).toEqual({ candidateId: 'candidate-c', withdrawnAt: { gt: read, lte: now } });
    expect(db.user.findUnique.mock.calls[0]![0].where).toEqual({ id: 'user-c' });
    expect(db.invitation.findMany.mock.calls[0]![0].where).toEqual({ candidateId: 'candidate-c', createdAt: { lte: now } });
    expect(db.invitation.count.mock.calls[0]![0].where).toEqual({ candidateId: 'candidate-c', createdAt: { gt: read, lte: now } });
    expect(feed).toMatchObject({ unread: 1, through: now.toISOString(), items: [{ href: '/invitations', unread: true }] });
  });

  it('lane invite-cancel: отзыв приглашения — уведомление кандидату с причиной', async () => {
    const read = new Date('2026-10-10T12:00:00Z');
    db.user.findUnique.mockResolvedValue({ role: 'candidate', candidateNotificationsReadAt: read, employerNotificationsReadAt: null });
    db.invitation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'i9', withdrawnAt: new Date('2026-10-10T14:30:00Z'), withdrawReason: 'Позиция закрыта', company: { name: 'Альфа' } }]);
    db.invitation.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const feed = await notifications(candidate);
    expect(feed).toMatchObject({ unread: 1, items: [{ id: 'withdrawn-i9', text: '«Альфа» отозвала приглашение', detail: 'Позиция закрыта', href: '/invitations', unread: true }] });
  });

  it('employer sees answers to its profile invitations, not another employer in the company', async () => {
    db.user.findUnique.mockResolvedValue({ role: 'employer', candidateNotificationsReadAt: now, employerNotificationsReadAt: null });
    db.invitation.findMany.mockResolvedValueOnce([{ id: 'i2', respondedAt: new Date('2026-10-10T14:00:00Z'), status: 'accepted', vacancy: { title: 'Backend' } }]);
    const feed = await notifications(employer);
    expect(db.invitation.findMany.mock.calls[0]![0].where).toEqual({ employerProfileId: 'employer-e', respondedAt: { not: null, lte: now } });
    expect(feed.items[0]!).toMatchObject({ text: 'Кандидат принял приглашение', href: '/employer/invitations', unread: true });
  });

  it('lane live-slots: события живой защиты — только своей стороне, в общей ленте и счётчике', async () => {
    const read = new Date('2026-10-10T12:00:00Z');
    db.user.findUnique.mockResolvedValue({ role: 'employer', candidateNotificationsReadAt: null, employerNotificationsReadAt: read });
    db.invitation.findMany.mockResolvedValueOnce([{ id: 'i2', respondedAt: new Date('2026-10-10T11:00:00Z'), status: 'accepted', vacancy: null }]);
    db.liveDefenseEvent.findMany.mockResolvedValue([{ id: 'e1', text: 'Кандидат выбрал время живой защиты', detail: 'пн 14:00', createdAt: new Date('2026-10-10T14:30:00Z') }]);
    db.liveDefenseEvent.count.mockResolvedValue(1);
    const feed = await notifications(employer);
    expect(db.liveDefenseEvent.findMany.mock.calls[0]![0].where).toEqual({ companyId: 'co-e', audience: 'employer', createdAt: { lte: now } });
    expect(feed.unread).toBe(1);
    expect(feed.items.map((i) => i.id)).toEqual(['live-e1', 'i2']);
  });

  it('lane lifecycle: кандидат нанят другой компанией — приглашение компании закрыто, имя нанявшей не раскрывается', async () => {
    db.user.findUnique.mockResolvedValue({ role: 'employer', candidateNotificationsReadAt: null, employerNotificationsReadAt: null });
    db.invitation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'i3', closedAt: new Date('2026-10-10T14:40:00Z'), vacancy: { title: 'Backend' } }]);
    db.invitation.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const feed = await notifications(employer);
    expect(db.invitation.findMany.mock.calls[1]![0].where).toEqual({ companyId: 'co-e', status: 'closed_hired', closedAt: { not: null, lte: now } });
    expect(feed.unread).toBe(1);
    expect(feed.items[0]).toMatchObject({ id: 'closed-i3', text: 'Кандидат принял предложение другой компании', detail: 'Приглашение закрыто · Backend', unread: true });
  });

  it('rejects missing or changed accounts before reading events', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(notifications(candidate)).rejects.toMatchObject({ status: 401 });
    db.user.findUnique.mockResolvedValue({ role: 'employer' });
    await expect(notifications(candidate)).rejects.toMatchObject({ status: 401 });
    expect(db.invitation.findMany).not.toHaveBeenCalled();
  });

  it('rejects future watermarks and advances only the active role without moving backwards', async () => {
    await expect(markNotificationsRead(candidate, new Date(now.getTime() + 1))).rejects.toMatchObject({ status: 400 });
    expect(db.user.updateMany).not.toHaveBeenCalled();
    const through = new Date('2026-10-10T14:30:00Z');
    await markNotificationsRead(employer, through);
    expect(db.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-e', role: 'employer', OR: [{ employerNotificationsReadAt: null }, { employerNotificationsReadAt: { lt: through } }] }, data: { employerNotificationsReadAt: through } });
  });
});
