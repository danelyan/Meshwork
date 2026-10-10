import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PausedFeed, RESUME_LABEL } from '@/components/onboarding/PausedFeed';
import { RESUME_BUTTON } from '@/server/agent/onboarding-aside';
import type { OnboardingView } from '@/server/onboarding/types';

// «Настроить позже» на /consultant (решение владельца 10.10): шаги на паузе, дальше свободный разговор.
const chatProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('@/components/Chat', () => ({
  Chat: (p: Record<string, unknown>) => {
    chatProps.last = p;
    return <div data-testid="chat" />;
  },
}));

const push = vi.fn();
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: push } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

const view = {
  name: 'Иван',
  role: 'candidate',
  scenario: 'candidate',
  consent: { version: 'v1', docUrl: '/consent' },
  progress: { done: 3, total: 10 },
  history: [{ stepId: 'goal', lead: 'Начнём.', question: 'Зачем ты здесь?', answer: 'Ищу работу', editable: true }],
  current: { id: 'documents', kind: 'files', eyebrow: 'Документы', label: 'Документы', question: 'Пришли резюме или ссылки', lead: 'Теперь документы.', allowCustom: false, required: false },
  summary: null,
  laterTarget: '/consultant',
  test: { href: '/test', ready: true },
  onboarded: false,
  later: true,
} as OnboardingView;

const restored = {
  conversationId: 'conv-1',
  items: [
    { id: 'a', role: 'user' as const, text: 'Зачем цель?', stepId: 'goal' },
    { id: 'b', role: 'user' as const, text: 'Что подтянуть до мидла?' },
  ],
};

it('шаги — начало ленты, текущий вопрос не задаётся; разговор — тот же, без завершения онбординга', () => {
  render(<PausedFeed view={view} restored={restored} />);
  expect(screen.getByText('Ищу работу')).toBeDefined();
  expect(screen.getByText('Зачем цель?')).toBeDefined();
  expect(screen.getByTestId('ob-paused').textContent).toContain('Пришли резюме или ссылки');
  expect(chatProps.last?.initial).toEqual({ conversationId: 'conv-1', items: [restored.items[1]] });
  expect((chatProps.last?.embedded as { beforeSend?: unknown }).beforeSend).toBeUndefined();
});

it('«Вернуться к знакомству» — goto на текущий шаг и перерисовка ленты; подпись совпадает с напоминанием консультанта', async () => {
  expect(RESUME_LABEL).toBe(RESUME_BUTTON);
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...view, later: false }) }));
  vi.stubGlobal('fetch', fetchFn);
  render(<PausedFeed view={view} restored={restored} />);
  fireEvent.click(screen.getByRole('button', { name: RESUME_LABEL }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
  const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toEqual({ action: 'goto', stepId: 'documents' });
});
