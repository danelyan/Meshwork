import { careerVacancies } from '@/server/recommend/career';
import { recommendTargets } from '@/server/recommend/targets';
import type { CatalogEntry } from '@/server/claims/types';

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
const cats = vi.hoisted(() => ({ findMany: vi.fn().mockResolvedValue([]) }));
// lane admin (E-08, фаза 2): скрытые модератором вакансии — redFlagReview(status = hidden); здесь их нет.
vi.mock('@/server/db', () => ({ prisma: { vacancy: db, candidateCategory: cats, redFlagReview: { findMany: vi.fn().mockResolvedValue([]) } } }));
vi.mock('@/server/recommend/evidence', async (original) => {
  const source = await original<typeof import('@/server/recommend/evidence')>();
  return { ...source, assertCandidate: vi.fn().mockResolvedValue({ id: 'candidate' }), loadCatalog: vi.fn().mockResolvedValue(new Map([['sql', { id: 'sql', specialization: 'backend', statement: 'SQL', grades: ['middle'], weight: 1, adjacent: [] } as unknown as CatalogEntry]])), loadConfirmedIndex: vi.fn().mockResolvedValue(new Map()) };
});

const vacancy = (id: string) => ({ id, companyId: 'c', company: { name: 'Company' }, title: id, specialization: 'backend', grade: 'middle', salaryFrom: 100000, salaryTo: 200000, needs: [{ catalogId: 'sql', weight: 1 }], description: 'API development', teamDescription: null, stack: ['Python'] });
afterEach(() => { vi.clearAllMocks(); cats.findMany.mockResolvedValue([]); });

it('keeps saved vacancies with zero evidence and applies own saved IDs before limiting', async () => {
  db.findMany.mockResolvedValue([vacancy('low-match')]);
  const result = await careerVacancies('candidate', ['low-match']);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ archivedAt: null, id: { in: ['low-match'] } }) }));
  expect(result.targets).toHaveLength(1);
  expect(result.targets[0]).toMatchObject({ vacancyId: 'low-match', covered: 0, total: 1, matched: [], stack: ['Python'] });
  expect(result.targets[0]?.missing).toEqual([{ catalogId: 'sql', statement: 'SQL' }]);
  expect(result.targets[0]?.category).toEqual({ id: 'backend:middle', label: 'Backend · Middle', covered: 0, total: 1, missing: [{ catalogId: 'sql', statement: 'SQL' }] });
  expect(result.targets[0]?.reason).toBe('Требования вакансии: Закрываете 0 из 1, не хватает: SQL. Что ещё усилит профиль для категории Backend · Middle: SQL - полный список на «Навыках и грейде»');
});

it('preserves an empty favorites list instead of returning the entire catalogue', async () => {
  db.findMany.mockResolvedValue([]);
  const result = await careerVacancies('candidate', []);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ archivedAt: null, id: { in: [] } }) }));
  expect(result.targets).toEqual([]);
});

it('reports a truncated catalogue explicitly at the 200-row boundary', async () => {
  db.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, i) => vacancy(`v${i}`)));
  const result = await careerVacancies('candidate');
  expect(result.targets).toHaveLength(200);
  expect(result.truncated).toBe(true);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ archivedAt: null }), take: 201 }));
});

it('excludes archived vacancies in the original recommendation query too', async () => {
  db.findMany.mockResolvedValue([]);
  await recommendTargets('candidate', 5);
  expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ archivedAt: null }) }));
});

it('exposes categories and only a project task the candidate can take', async () => {
  cats.findMany.mockResolvedValue([{ specialization: 'backend', grade: 'middle' }]);
  const task = (id: string, visibility: string, specialization: string, grade: string) => ({ id, visibility, specialization, grade });
  db.findMany.mockResolvedValue([
    { ...vacancy('ok'), projectTasks: [task('t-ok', 'open', 'backend', 'middle')] },
    { ...vacancy('senior'), projectTasks: [task('t-senior', 'open', 'backend', 'senior')] },
    { ...vacancy('invited'), projectTasks: [task('t-inv', 'invited', 'backend', 'junior')] },
  ]);
  const result = await careerVacancies('candidate');
  expect(result.categories).toEqual([{ specialization: 'backend', grade: 'middle' }]);
  expect(Object.fromEntries(result.targets.map((t) => [t.vacancyId, t.projectTaskId]))).toEqual({ ok: 't-ok', senior: null, invited: null });
});
