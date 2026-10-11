import { answerStep, getView, gotoStep } from '@/server/onboarding/service';
const mocks = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn(), profile: vi.fn(), consent: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { user: { findUnique: mocks.find }, onboardingState: { upsert: mocks.save }, onboardingAnswerRevision: { createMany: vi.fn(async () => ({ count: 0 })) }, $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops), candidateProfile: { upsert: mocks.profile }, consent: { findMany: async () => [{ kind: 'ai_assessment' }] } } }));
vi.mock('@/server/auth/consent', async (orig) => ({ ...(await orig<typeof import('@/server/auth/consent')>()), hasCurrentConsent: mocks.consent }));
vi.mock('@/server/onboarding/phrase', async (orig) => ({ ...(await orig<typeof import('@/server/onboarding/phrase')>()), leadFor: async () => 'Уточним город.' }));
const at = new Date('2026-10-10T10:00:00Z');
function seeded(role = 'candidate', onboardedAt: Date | null = at) {
  return { id: 'u1', name: 'Юлия', role, onboardedAt, candidateId: 'c1', employerProfile: null,
    candidate: { id: 'c1', specialization: 'backend', subcategoryId: null, contact: '@yulia', fspState: 'not_linked', profile: { goal: 'job_search', claimedGrade: 'middle', city: 'Казань', stack: ['Python'], workFormats: ['remote'], salaryMin: 100000, salaryExpected: 180000, fspParticipation: 'none' } },
    onboarding: { stepId: 'summary', answers: {}, skipped: [], lines: {}, meta: { doneRoles: ['candidate'], byRole: { employer: { stepId: 'summary' } } } } };
}
beforeEach(() => { vi.resetAllMocks(); mocks.consent.mockResolvedValue(true); });
it('ready seeded remote candidate opens existing city and changes only city without resetting profile or other role', async () => {
  const user = seeded();
  mocks.find.mockImplementation(async () => user);
  mocks.save.mockImplementation(async ({ update }) => { Object.assign(user.onboarding, update); return user.onboarding; });
  mocks.profile.mockImplementation(async ({ update }) => { Object.assign(user.candidate.profile, update); return user.candidate.profile; });
  await gotoStep('u1', 'city');
  const view = await getView('u1');
  expect(view.onboarded).toBe(true);
  expect(view.current).toMatchObject({ id: 'city', kind: 'text', value: 'Казань' });
  expect(user.candidate.profile.workFormats).toEqual(['remote']);
  expect(mocks.profile).not.toHaveBeenCalled();
  await answerStep('u1', 'city', 'Москва');
  expect(mocks.profile).toHaveBeenCalledWith({ where: { candidateId: 'c1' }, create: { candidateId: 'c1', city: 'Москва' }, update: { city: 'Москва' } });
  expect(user.candidate.profile).toMatchObject({ city: 'Москва', workFormats: ['remote'], stack: ['Python'], salaryMin: 100000 });
  expect(user.onboardedAt).toBe(at);
  expect(user.onboarding.meta).toMatchObject({ doneRoles: ['candidate'], byRole: { employer: { stepId: 'summary' } } });
});
it.each([['employer', at, true], ['candidate', null, true], ['candidate', at, false]] as const)('does not enable hidden city editor for role %s / completion %s / consent %s', async (role, date, consent) => {
  mocks.find.mockResolvedValue(seeded(role, date)); mocks.consent.mockResolvedValue(consent);
  await expect(gotoStep('u1', 'city')).rejects.toThrow('Этот вопрос сейчас недоступен');
  expect(mocks.save).not.toHaveBeenCalled();
});
