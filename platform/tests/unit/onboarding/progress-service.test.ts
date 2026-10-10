// Подсчёт «заполнено N из M» для плашки: пропущенный шаг считается закрытым.
const findUnique = vi.hoisted(() => vi.fn());
const consent = vi.hoisted(() => vi.fn());
vi.mock('@/server/db', () => ({ prisma: { user: { findUnique }, consent: { findMany: async () => [] } } }));
vi.mock('@/server/auth/consent', async (orig) => ({ ...(await orig<typeof import('@/server/auth/consent')>()), hasCurrentConsent: consent }));

import { onboardingProgress } from '@/server/onboarding/service';

const user = (onboarding: { answers?: Record<string, unknown>; skipped?: string[] } | null) => ({
  id: 'u1',
  name: 'Иван',
  role: 'candidate',
  onboardedAt: null,
  candidateId: 'c1',
  employerProfile: null,
  candidate: { id: 'c1', fspState: null, specialization: null },
  onboarding: onboarding && { stepId: null, answers: onboarding.answers ?? {}, skipped: onboarding.skipped ?? [], lines: {}, meta: {} },
});

beforeEach(() => consent.mockResolvedValue(true));

it('пропущенный шаг засчитывается как заполненный', async () => {
  findUnique.mockResolvedValueOnce(user({ answers: { consent: true, role: 'candidate' } }));
  const before = await onboardingProgress('u1');
  findUnique.mockResolvedValueOnce(user({ answers: { consent: true, role: 'candidate' }, skipped: ['goal'] }));
  const after = await onboardingProgress('u1');
  expect(before.total).toBeGreaterThan(2);
  expect(after.total).toBe(before.total);
  expect(after.done).toBe(before.done + 1);
});
