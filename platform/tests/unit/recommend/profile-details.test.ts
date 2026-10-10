import { profileDetails } from '@/server/claims/profile-details';
const mocks = vi.hoisted(() => ({ candidate: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { candidate: { findUnique: mocks.candidate } } }));
vi.mock('@/server/recommend/evidence', () => ({ loadCatalog: async () => new Map([['sql', { id: 'sql', statement: 'Работает с SQL' }]]) }));
beforeEach(() => vi.resetAllMocks());
it('keeps own private contact and questionnaire separate from exact anonymous employer projection', async () => {
  mocks.candidate.mockResolvedValue({ id: 'own', name: 'Private Name', email: 'private@example.test', contact: '@private', specialization: 'backend', fspState: 'none', hiddenFromEmployers: false, profile: { city: 'Москва', goal: 'job', claimedGrade: 'middle', stack: ['Python'], workFormats: ['remote'], salaryMin: 100000, salaryExpected: 150000, fspParticipation: 'no' }, categories: [], claims: [{ catalogId: 'sql', level: 'self_reported', sourceKind: 'resume' }] });
  const result = await profileDetails('own');
  expect(mocks.candidate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'own' } }));
  expect(result.contact).toBe('@private');
  expect(result.basics?.city).toBe('Москва');
  expect(result.completion).toEqual({ filled: 9, total: 9 });
  expect(result.employerPreview.contacts).toBeNull();
  expect(result.employerPreview.displayName).toMatch(/^Кандидат #/);
  expect(JSON.stringify(result.employerPreview)).not.toMatch(/Private Name|private@example|@private|Москва/);
  expect(result.employerPreview.claims[0]?.statement).toBe('Работает с SQL');
});
it('reports missing profile without inventing completion values', async () => {
  mocks.candidate.mockResolvedValue(null);
  await expect(profileDetails('gone')).rejects.toThrow();
});
