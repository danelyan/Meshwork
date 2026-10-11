import { callReadiness } from '@/server/call/readiness';

const db = vi.hoisted(() => ({
  claim: { count: vi.fn() },
  candidateCategory: { count: vi.fn() },
  candidate: { findUnique: vi.fn() },
  callSession: { findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const now = Date.parse('2026-10-11T12:00:00Z');
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.claim.count.mockResolvedValue(1);
  db.candidateCategory.count.mockResolvedValue(1);
  db.candidate.findUnique.mockResolvedValue({ isDemo: false });
  db.callSession.findFirst.mockResolvedValue(null); // нет активного
  db.callSession.findMany.mockResolvedValue([]);
});

describe('callReadiness: созвон только когда есть о чём говорить', () => {
  it('qualifying: нет утверждений – не готов, есть – готов', async () => {
    db.claim.count.mockResolvedValue(0);
    expect(await callReadiness('c', 'qualifying', now)).toMatchObject({ ready: false, reason: expect.stringContaining('будет о чём поговорить') });
    db.claim.count.mockResolvedValue(2);
    expect(await callReadiness('c', 'qualifying', now)).toEqual({ ready: true });
  });

  it('interview: нет категории из теста – «после теста»', async () => {
    db.candidateCategory.count.mockResolvedValue(0);
    expect(await callReadiness('c', 'interview', now)).toEqual({ ready: false, reason: 'Созвон с ИИ откроется после теста' });
    expect(db.candidateCategory.count.mock.calls[0]![0].where).toMatchObject({ source: 'test' });
  });

  it('пауза: завершённый созвон с вердиктом <24 ч – отказ с retryAt, ≥24 ч – можно', async () => {
    db.callSession.findMany.mockResolvedValue([{ finishedAt: hoursAgo(5), verdictJson: { x: 1 } }]);
    const r = await callReadiness('c', 'qualifying', now);
    expect(r).toMatchObject({ ready: false, reason: 'Повторный созвон - через 19 ч', retryAt: new Date(now + 19 * 3_600_000).toISOString() });
    db.callSession.findMany.mockResolvedValue([{ finishedAt: hoursAgo(24), verdictJson: { x: 1 } }]);
    expect(await callReadiness('c', 'qualifying', now)).toEqual({ ready: true });
  });

  it('отменённый (без вердикта) созвон паузу не запускает', async () => {
    db.callSession.findMany.mockResolvedValue([{ finishedAt: hoursAgo(1), verdictJson: null }]);
    expect(await callReadiness('c', 'qualifying', now)).toEqual({ ready: true });
  });

  it('демо-кандидат от паузы освобождён', async () => {
    db.candidate.findUnique.mockResolvedValue({ isDemo: true });
    db.callSession.findMany.mockResolvedValue([{ finishedAt: hoursAgo(1), verdictJson: { x: 1 } }]);
    expect(await callReadiness('c', 'qualifying', now)).toEqual({ ready: true });
  });

  it('активный созвон продолжается без проверок; defense не затронут', async () => {
    db.claim.count.mockResolvedValue(0);
    db.callSession.findFirst.mockResolvedValue({ id: 'act' });
    expect(await callReadiness('c', 'qualifying', now)).toEqual({ ready: true });
    expect(await callReadiness('c', 'defense', now)).toEqual({ ready: true });
  });
});
