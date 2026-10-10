import { careerVacancies } from '@/server/recommend/career';
import { recommendTargets } from '@/server/recommend/targets';
import type { CatalogEntry } from '@/server/claims/types';

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { vacancy: db } }));
vi.mock('@/server/recommend/evidence', async (original) => {
  const source = await original<typeof import('@/server/recommend/evidence')>();
  return { ...source, assertCandidate: vi.fn().mockResolvedValue({ id: 'candidate' }), loadCatalog: vi.fn().mockResolvedValue(new Map([['sql', { id: 'sql', statement: 'SQL', adjacent: [] } as unknown as CatalogEntry]])), loadConfirmedIndex: vi.fn().mockResolvedValue(new Map()) };
});

const vacancy = (id: string) => ({ id, companyId: 'c', company: { name: 'Company' }, title: id, specialization: 'backend', grade: 'middle', salaryFrom: 100000, salaryTo: 200000, needs: [{ catalogId: 'sql', weight: 1 }], description: 'API development', teamDescription: null, stack: ['Python'] });
afterEach(() => vi.clearAllMocks());

it('keeps saved vacancies with zero evidence and applies own saved IDs before limiting', async () => {
  db.findMany.mockResolvedValue([vacancy('low-match')]);
  const result = await careerVacancies('candidate', ['low-match']);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null, id: { in: ['low-match'] } } }));
  expect(result.targets).toHaveLength(1);
  expect(result.targets[0]).toMatchObject({ vacancyId: 'low-match', covered: 0, total: 1, matched: [], stack: ['Python'] });
  expect(result.targets[0]?.missing).toEqual([{ catalogId: 'sql', statement: 'SQL' }]);
});

it('preserves an empty favorites list instead of returning the entire catalogue', async () => {
  db.findMany.mockResolvedValue([]);
  const result = await careerVacancies('candidate', []);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null, id: { in: [] } } }));
  expect(result.targets).toEqual([]);
});

it('reports a truncated catalogue explicitly at the 200-row boundary', async () => {
  db.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, i) => vacancy(`v${i}`)));
  const result = await careerVacancies('candidate');
  expect(result.targets).toHaveLength(200);
  expect(result.truncated).toBe(true);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null }, take: 201 }));
});

it('excludes archived vacancies in the original recommendation query too', async () => {
  db.findMany.mockResolvedValue([]);
  await recommendTargets('candidate', 5);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null } }));
});
