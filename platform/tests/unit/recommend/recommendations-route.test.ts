import { GET } from '@/app/api/recommendations/route';

const mocks = vi.hoisted(() => ({ candidate: vi.fn(), gapMap: vi.fn(), targets: vi.fn(), tasks: vi.fn(), test: vi.fn(), category: vi.fn() }));
vi.mock('@/server/session', () => ({ requireCandidate: mocks.candidate }));
vi.mock('@/server/auth/stale', () => ({ isSessionStale: async () => false }));
vi.mock('@/server/db', () => ({ prisma: { candidateCategory: { findFirst: mocks.category } } }));
vi.mock('@/server/recommend/gap-map', () => ({ gapMap: mocks.gapMap }));
vi.mock('@/server/recommend/targets', () => ({ recommendTargets: mocks.targets }));
vi.mock('@/server/recommend/tasks', () => ({ recommendTasks: mocks.tasks }));
vi.mock('@/server/recommend/test', () => ({ recommendTest: mocks.test }));

const get = (query: string) => GET(new Request(`http://localhost/api/recommendations${query}`));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.candidate.mockReturnValue('c1');
  mocks.gapMap.mockResolvedValue([]);
  mocks.targets.mockResolvedValue([]);
  mocks.tasks.mockResolvedValue([]);
  mocks.test.mockResolvedValue({ specialization: 'backend', grade: 'junior', reason: '', allowed: true });
  mocks.category.mockResolvedValue(null);
});

describe('GET /api/recommendations: цель-категория', () => {
  it.each(['backend:junior', 'frontend:middle', 'ai:junior', 'ai:senior', 'engineering:middle', 'backend:senior'])('category:%s принимается', async (id) => {
    const res = await get(`?target=category:${id}`);
    expect(res.status).toBe(200);
    expect(mocks.gapMap).toHaveBeenCalledWith('c1', { kind: 'category', id });
    expect(((await res.json()) as { target: string }).target).toBe(`category:${id}`);
  });

  it('чужие значения и хвосты - 400 до обращения к данным', async () => {
    for (const t of ['category:mobile:junior', 'category:ai:lead', 'category:ai', 'category:ai:senior:x', 'xcategory:ai:senior', 'evil']) {
      expect((await get(`?target=${t}`)).status, t).toBe(400);
    }
    expect(mocks.gapMap).not.toHaveBeenCalled();
  });

  it('без target: категория из теста (AI Senior) становится целью', async () => {
    mocks.category.mockResolvedValue({ specialization: 'ai', grade: 'senior' });
    const res = await get('');
    expect(res.status).toBe(200);
    expect(mocks.gapMap).toHaveBeenCalledWith('c1', { kind: 'category', id: 'ai:senior' });
  });
});
