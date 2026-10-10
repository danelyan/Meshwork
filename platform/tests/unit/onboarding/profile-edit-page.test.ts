import ConsultantPage from '@/app/(shared)/consultant/page';
import { CandidateHome } from '@/app/(shared)/consultant/CandidateHome';
import { EmployerHome } from '@/app/(shared)/consultant/EmployerHome';
const mocks = vi.hoisted(() => ({ account: vi.fn(), inFeed: vi.fn(), view: vi.fn() }));
vi.mock('@/server/auth/page', () => ({ requirePageAccount: mocks.account }));
vi.mock('@/server/onboarding/service', () => ({ getView: mocks.view, onboardingInFeed: mocks.inFeed }));
vi.mock('@/app/(shared)/consultant/CandidateHome', () => ({ CandidateHome: () => null }));
vi.mock('@/app/(shared)/consultant/EmployerHome', () => ({ EmployerHome: () => null }));
vi.mock('@/components/avatar/AvatarScene', () => ({ AvatarScene: () => null }));
vi.mock('@/components/onboarding/OnboardingChat', () => ({ OnboardingChat: () => null }));
vi.mock('@/server/demo/context', () => ({ chatDemoContextFromCookies: async () => ({}) }));
beforeEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue({ userId: 'own', role: 'candidate', candidateId: 'candidate-own' }); mocks.inFeed.mockResolvedValue(false); mocks.view.mockResolvedValue({ onboarded: true, current: { id: 'city', kind: 'text' } }); });
it('completed candidate with a saved goto step gets its editor only in explicit profile edit mode', async () => {
  const page = await ConsultantPage({ searchParams: Promise.resolve({ edit: 'profile' }) });
  expect(mocks.account).toHaveBeenCalledWith('/consultant');
  expect(mocks.view).toHaveBeenCalledWith('own');
  expect(page.type).toBe(CandidateHome);
  expect(page.props).toMatchObject({ candidateId: 'candidate-own', view: { onboarded: true, current: { id: 'city' } } });
});
it('normal completed demo still opens chat without restarting questionnaire', async () => {
  const page = await ConsultantPage();
  expect(mocks.view).not.toHaveBeenCalled();
  expect(page.props).toMatchObject({ view: undefined });
});
it('candidate edit flag does not open the employer questionnaire', async () => {
  mocks.account.mockResolvedValue({ userId: 'own', role: 'employer', employerProfileId: 'employer-own' });
  const page = await ConsultantPage({ searchParams: Promise.resolve({ edit: 'profile' }) });
  expect(page.type).toBe(EmployerHome);
  expect(mocks.view).not.toHaveBeenCalled();
});
it('requires authenticated account before resolving edit view', async () => {
  mocks.account.mockRejectedValue(new Error('unauthorized'));
  await expect(ConsultantPage({ searchParams: Promise.resolve({ edit: 'profile' }) })).rejects.toThrow('unauthorized');
  expect(mocks.view).not.toHaveBeenCalled();
});
