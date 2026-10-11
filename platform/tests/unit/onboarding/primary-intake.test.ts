import { answerStep, finishLater, getView, gotoStep, skipStep } from '@/server/onboarding/service';
import { CANDIDATE_STEPS, PRIVATE_INTAKE_STEPS } from '@/server/onboarding/scenario';
import type { Answers } from '@/server/onboarding/types';

const mocks = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn(), profile: vi.fn(), candidate: vi.fn(), claim: vi.fn(), category: vi.fn(), consent: vi.fn(), lead: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: {
  user: { findUnique: mocks.find }, onboardingState: { upsert: mocks.save }, candidateProfile: { upsert: mocks.profile },
  candidate: { update: mocks.candidate }, claim: { create: mocks.claim, count: async () => 0 }, candidateCategory: { create: mocks.category },
} }));
vi.mock('@/server/auth/consent', async (orig) => ({ ...(await orig<typeof import('@/server/auth/consent')>()), hasCurrentConsent: mocks.consent }));
vi.mock('@/server/onboarding/phrase', async (orig) => ({ ...(await orig<typeof import('@/server/onboarding/phrase')>()), leadFor: mocks.lead }));

function fixture(onboardedAt: Date | null = null) {
  const user = { id: 'u1', name: 'Юлия', role: 'candidate', onboardedAt, candidateId: 'c1', employerProfile: null,
    candidate: { id: 'c1', specialization: null, subcategoryId: null, contact: null, fspState: 'not_linked', profile: null },
    onboarding: { stepId: 'experience', answers: {} as Answers, skipped: [] as string[], lines: {}, meta: {} as Record<string, unknown> } };
  mocks.find.mockImplementation(async () => user);
  mocks.save.mockImplementation(async ({ update }) => { Object.assign(user.onboarding, update); return user.onboarding; });
  return user;
}
beforeEach(() => { vi.resetAllMocks(); mocks.consent.mockResolvedValue(true); mocks.lead.mockResolvedValue('Продолжим знакомство.'); });

it('first candidate answer and skip advance without automatically pausing', async () => {
  const user = fixture();
  await answerStep('u1', 'experience', 'oneToThree');
  expect(await getView('u1')).toMatchObject({ current: { id: 'experienceSummary' }, later: false, onboarded: false });
  await skipStep('u1', 'experienceSummary');
  expect(await getView('u1')).toMatchObject({ current: { id: 'candidateIndustries' }, later: false });
  expect(user.onboarding.answers.experience).toBe('oneToThree');
  expect(user.onboardedAt).toBeNull();
});

it('explicit later stays paused; opening one field afterwards returns to chat after answering', async () => {
  const user = fixture();
  user.onboarding.stepId = 'goal';
  expect(await finishLater('u1')).toEqual({ next: '/consultant' });
  expect(await getView('u1')).toMatchObject({ later: true });
  await gotoStep('u1', 'experience');
  expect(await getView('u1')).toMatchObject({ later: false });
  await answerStep('u1', 'experience', 'underOne');
  expect(await getView('u1')).toMatchObject({ current: { id: 'experienceSummary' }, later: true, onboarded: false });
  await gotoStep('u1', 'experienceSummary');
  await skipStep('u1', 'experienceSummary');
  expect(await getView('u1')).toMatchObject({ current: { id: 'candidateIndustries' }, later: false });
  expect(user.onboarding.meta).not.toHaveProperty('manualProfileEdit');
});

it('private self-reports save only to the owner onboarding JSON, never profile, claims or category', async () => {
  const user = fixture();
  await answerStep('u1', 'experience', 'fivePlus');
  await answerStep('u1', 'experienceSummary', 'Разработала API учебного сервиса, отвечала за тестирование.');
  await answerStep('u1', 'candidateIndustries', ['Образование', 'образование', 'Логистика']);
  expect(user.onboarding.answers).toEqual({ experience: 'fivePlus', experienceSummary: 'Разработала API учебного сервиса, отвечала за тестирование.', candidateIndustries: ['Образование', 'Логистика'] });
  expect(mocks.save.mock.calls.every(([args]) => args.where.userId === 'u1')).toBe(true);
  for (const write of [mocks.profile, mocks.candidate, mocks.claim, mocks.category]) expect(write).not.toHaveBeenCalled();
});

it('old completed state stays on its summary, but new optional fields remain explicitly editable', async () => {
  const at = new Date('2026-10-10T10:00:00Z');
  const user = fixture(at);
  user.onboarding.stepId = 'summary';
  user.onboarding.skipped = CANDIDATE_STEPS.filter((s) => !(PRIVATE_INTAKE_STEPS as readonly string[]).includes(s.id)).map((s) => s.id);
  user.onboarding.meta = { doneRoles: ['candidate'], byRole: { employer: { stepId: 'needSalary' } } };
  expect(await getView('u1')).toMatchObject({ current: { id: 'summary' }, onboarded: true });
  await gotoStep('u1', 'experience');
  expect(await getView('u1')).toMatchObject({ current: { id: 'experience' }, onboarded: true, later: false });
  await answerStep('u1', 'experience', 'oneToThree');
  expect(await getView('u1')).toMatchObject({ current: { id: 'summary' }, onboarded: true });
  expect(user.onboardedAt).toBe(at);
  expect(user.onboarding.meta).toMatchObject({ doneRoles: ['candidate'], byRole: { employer: { stepId: 'needSalary' } } });
  expect(user.onboarding.skipped).not.toContain('experience');
  expect(mocks.profile).not.toHaveBeenCalled();
});

it('an unfinished old questionnaire retains its saved step and answers after reordering', async () => {
  const user = fixture();
  user.onboarding.stepId = 'stack';
  user.onboarding.answers = { goal: 'market_watch', grade: 'middle' };
  expect(await getView('u1')).toMatchObject({ current: { id: 'stack' }, history: expect.arrayContaining([expect.objectContaining({ stepId: 'grade', answer: 'Middle' })]) });
  expect(user.onboarding.answers).toEqual({ goal: 'market_watch', grade: 'middle' });
});

it.each([['pending', true], ['candidate', false], ['employer', false]])('does not call the model before role and consent: %s / consent %s', async (role, consent) => {
  const user = fixture(); user.role = role; mocks.consent.mockResolvedValue(consent);
  await getView('u1');
  expect(mocks.lead).not.toHaveBeenCalled();
});
