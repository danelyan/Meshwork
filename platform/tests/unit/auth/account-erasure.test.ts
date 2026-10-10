import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { eraseOwnAccount, ownedDirectory } from '@/server/auth/erase-account';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), delete: vi.fn() },
  callSession: { findMany: vi.fn() },
  defenseRoomPlan: { deleteMany: vi.fn() },
  employerConversation: { findMany: vi.fn() },
  agentRun: { deleteMany: vi.fn() },
  candidate: { deleteMany: vi.fn() },
  invitation: { deleteMany: vi.fn() },
  employerProfile: { deleteMany: vi.fn(), count: vi.fn() },
  company: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('node:fs/promises', () => ({ rm: vi.fn() }));
vi.mock('@/server/uploads/storage', () => ({ uploadRoot: () => resolve('test-erasure-uploads') }));
vi.mock('@/server/env', () => ({ getEnv: () => ({ CALL_DATA_DIR: resolve('test-erasure-calls') }) }));

beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({ isDemo: false, accounts: [{ provider: 'email' }], candidateId: 'own-candidate', employerProfile: null });
  db.callSession.findMany.mockResolvedValue([]);
  db.employerConversation.findMany.mockResolvedValue([]);
  vi.mocked(rm).mockResolvedValue(undefined);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<void>) => work(db));
});

describe('account erasure storage boundary', () => {
  it.each(['', '..', '../victim', '..\\victim', '/tmp/victim', 'C:\\victim', 'a/b', 'a\\b', 'a'.repeat(65)])('rejects unsafe identifier %j', (id) => {
    expect(() => ownedDirectory('storage', id)).toThrow();
  });
  it('resolves only a direct child for a server ID', () => {
    expect(ownedDirectory('storage', 'candidate_123-ab')).toBe(resolve('storage', 'candidate_123-ab'));
  });
  it('refuses shared demo users before touching their files or data', async () => {
    db.user.findUnique.mockResolvedValue({ isDemo: true, accounts: [], candidateId: 'shared', employerProfile: null });
    await expect(eraseOwnAccount('shared-user')).rejects.toMatchObject({ status: 403 });
    expect(rm).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('keeps database identifiers available for retry after storage failure', async () => {
    vi.mocked(rm).mockRejectedValueOnce(new Error('EACCES'));
    await expect(eraseOwnAccount('own-user')).rejects.toThrow('EACCES');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.delete).not.toHaveBeenCalled();
  });
  it('does not erase an active call or its owner', async () => {
    db.callSession.findMany.mockResolvedValue([{ id: 'active-call', status: 'active' }]);
    await expect(eraseOwnAccount('own-user')).rejects.toMatchObject({ status: 409 });
    expect(rm).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('erases both owned profiles but retains a company with another employer', async () => {
    db.user.findUnique.mockResolvedValue({ isDemo: true, accounts: [{ provider: 'demo' }], candidateId: 'own-candidate', employerProfile: { id: 'own-employer', companyId: 'shared-company' } });
    db.callSession.findMany.mockResolvedValue([{ id: 'own-call', status: 'finished' }]);
    db.employerProfile.count.mockResolvedValue(1);
    db.employerConversation.findMany.mockResolvedValue([{ id: 'own-employer-conversation' }]);
    await eraseOwnAccount('own-user');
    expect(rm).toHaveBeenCalledWith(resolve('test-erasure-uploads', 'own-candidate'), { recursive: true, force: true });
    expect(rm).toHaveBeenCalledWith(resolve('test-erasure-calls', 'calls', 'own-call'), { recursive: true, force: true });
    expect(db.candidate.deleteMany).toHaveBeenCalledWith({ where: { id: 'own-candidate' } });
    expect(db.defenseRoomPlan.deleteMany).toHaveBeenCalledWith({ where: { callSessionId: { in: ['own-call'] } } });
    expect(db.employerConversation.findMany).toHaveBeenCalledWith({ where: { employerProfileId: 'own-employer' }, select: { id: true } });
    expect(db.agentRun.deleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ['own-employer-conversation'] } } });
    expect(db.employerProfile.deleteMany).toHaveBeenCalledWith({ where: { id: 'own-employer' } });
    expect(db.company.deleteMany).not.toHaveBeenCalled();
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'own-user' } });
  });
});
