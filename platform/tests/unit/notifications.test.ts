import { markNotificationsRead, notifications } from '@/server/auth/notifications';

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn(), updateMany: vi.fn() }, invitation: { findMany: vi.fn(), count: vi.fn() } }));
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
});
afterEach(() => vi.useRealTimers());

describe('notification role scopes and read watermarks', () => {
  it('queries only the signed candidate and its own role watermark', async () => {
    const read = new Date('2026-10-10T12:00:00Z');
    db.user.findUnique.mockResolvedValue({ role: 'candidate', candidateNotificationsReadAt: read, employerNotificationsReadAt: now });
    db.invitation.findMany.mockResolvedValue([{ id: 'i1', createdAt: new Date('2026-10-10T14:00:00Z'), company: { name: 'Компания' }, vacancy: null, salaryFrom: 100000, salaryTo: 200000 }]);
    db.invitation.count.mockResolvedValue(1);
    const feed = await notifications(candidate);
    expect(db.user.findUnique.mock.calls[0]![0].where).toEqual({ id: 'user-c' });
    expect(db.invitation.findMany.mock.calls[0]![0].where).toEqual({ candidateId: 'candidate-c', createdAt: { lte: now } });
    expect(db.invitation.count.mock.calls[0]![0].where).toEqual({ candidateId: 'candidate-c', createdAt: { gt: read, lte: now } });
    expect(feed).toMatchObject({ unread: 1, through: now.toISOString(), items: [{ href: '/invitations', unread: true }] });
  });

  it('employer sees answers to its profile invitations, not another employer in the company', async () => {
    db.user.findUnique.mockResolvedValue({ role: 'employer', candidateNotificationsReadAt: now, employerNotificationsReadAt: null });
    db.invitation.findMany.mockResolvedValue([{ id: 'i2', respondedAt: new Date('2026-10-10T14:00:00Z'), status: 'accepted', vacancy: { title: 'Backend' } }]);
    const feed = await notifications(employer);
    expect(db.invitation.findMany.mock.calls[0]![0].where).toEqual({ employerProfileId: 'employer-e', respondedAt: { not: null, lte: now } });
    expect(feed.items[0]!).toMatchObject({ text: 'Кандидат принял приглашение', href: '/employer/invitations', unread: true });
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
