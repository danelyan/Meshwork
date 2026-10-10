// Когда /consultant показывает шаги онбординга в ленте (решение владельца 10.10).
const findUnique = vi.hoisted(() => vi.fn());
vi.mock('@/server/db', () => ({ prisma: { user: { findUnique } } }));

import { onboardingInFeed } from '@/server/onboarding/service';

const at = new Date('2026-10-10T10:00:00Z');

it.each([
  ['знакомство не завершено, состояния нет', { onboardedAt: null, onboarding: null }, true],
  ['знакомство не завершено, посреди шагов', { onboardedAt: null, onboarding: { stepId: 'goal' } }, true],
  ['завершено в чате (состояние на итоге)', { onboardedAt: at, onboarding: { stepId: 'summary' } }, true],
  ['завершено без чата (сид демо)', { onboardedAt: at, onboarding: null }, false],
  ['завершено, старое состояние посреди шагов', { onboardedAt: at, onboarding: { stepId: 'documents' } }, false],
  ['роль не выбрана (даже с отметкой завершения)', { role: 'pending', onboardedAt: at, onboarding: null }, true],
  ['аккаунта нет', null, false],
])('%s', async (_name, user, expected) => {
  findUnique.mockResolvedValueOnce(user);
  expect(await onboardingInFeed('u1')).toBe(expected);
});
