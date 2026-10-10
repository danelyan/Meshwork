import { GET } from '@/app/api/career/vacancies/route';
import { errors } from '@/server/errors';

const mocks = vi.hoisted(() => ({ candidate: vi.fn(), user: vi.fn(), favorites: vi.fn(), vacancies: vi.fn() }));
vi.mock('@/server/session', () => ({ requireCandidate: mocks.candidate, requireUser: mocks.user }));
vi.mock('@/server/auth/stale', () => ({ isSessionStale: async () => false }));
vi.mock('@/server/favorites', () => ({ listFavorites: mocks.favorites }));
vi.mock('@/server/recommend/career', () => ({ careerVacancies: mocks.vacancies }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.candidate.mockReturnValue('own-candidate');
  mocks.user.mockReturnValue({ userId: 'own-user', role: 'candidate', candidateId: 'own-candidate' });
  mocks.favorites.mockResolvedValue({ kind: 'vacancy', ids: ['saved-1'] });
  mocks.vacancies.mockResolvedValue({ targets: [], truncated: false });
});

it('uses authenticated ownership for saved catalogue, never client supplied identifiers', async () => {
  const response = await GET(new Request('http://localhost/api/career/vacancies?saved=true'));
  expect(response.status).toBe(200);
  expect(mocks.favorites).toHaveBeenCalledWith(expect.objectContaining({ userId: 'own-user' }));
  expect(mocks.vacancies).toHaveBeenCalledWith('own-candidate', ['saved-1']);
  const injected = await GET(new Request('http://localhost/api/career/vacancies?saved=true&userId=other'));
  expect(injected.status).toBe(400);
});

it('rejects malformed saved filter and unauthenticated access', async () => {
  expect((await GET(new Request('http://localhost/api/career/vacancies?saved=anything'))).status).toBe(400);
  mocks.candidate.mockImplementation(() => { throw errors.unauthorized(); });
  expect((await GET(new Request('http://localhost/api/career/vacancies'))).status).toBe(401);
  expect(mocks.vacancies).not.toHaveBeenCalled();
});

it('rejects employer role at the candidate guard', async () => {
  mocks.candidate.mockImplementation(() => { throw errors.forbidden(); });
  expect((await GET(new Request('http://localhost/api/career/vacancies'))).status).toBe(403);
  expect(mocks.favorites).not.toHaveBeenCalled();
});
