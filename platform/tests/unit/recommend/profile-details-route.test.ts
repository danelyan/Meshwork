import { GET } from '@/app/api/profile/details/route';
import { errors } from '@/server/errors';
const mocks = vi.hoisted(() => ({ candidate: vi.fn(), details: vi.fn() }));
vi.mock('@/server/session', () => ({ requireCandidate: mocks.candidate }));
vi.mock('@/server/auth/stale', () => ({ isSessionStale: async () => false }));
vi.mock('@/server/claims/profile-details', () => ({ profileDetails: mocks.details }));
beforeEach(() => { vi.resetAllMocks(); mocks.candidate.mockReturnValue('own'); mocks.details.mockResolvedValue({ contact: '@own' }); });
it('reads only authenticated candidate, ignoring injected candidate ID', async () => {
  const res = await GET(new Request('http://localhost/api/profile/details?candidateId=other'));
  expect(res.status).toBe(200);
  expect(mocks.details).toHaveBeenCalledWith('own');
  expect(await res.json()).toEqual({ contact: '@own' });
});
it.each([['unauthorized', 401], ['forbidden', 403]] as const)('rejects %s identity before reading profile', async (kind, status) => {
  mocks.candidate.mockImplementation(() => { throw errors[kind](); });
  expect((await GET(new Request('http://localhost/api/profile/details'))).status).toBe(status);
  expect(mocks.details).not.toHaveBeenCalled();
});
