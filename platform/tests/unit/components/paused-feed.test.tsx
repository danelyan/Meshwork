import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { FILL_LABEL, PausedFeed } from '@/components/onboarding/PausedFeed';
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

const assistantProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('@/components/employer/AssistantChat', () => ({
  AssistantChat: (p: Record<string, unknown>) => {
    assistantProps.last = p;
    return <div data-testid="assistant" />;
  },
  EmployerAsideRows: ({ items }: { items?: Array<{ text?: string }> }) => <>{items?.map((i) => <p key={i.text}>{i.text}</p>)}</>,
}));

const push = vi.fn();
// мягкое обновление (soft-nav.ts): на том же адресе — router.refresh, без перезагрузки
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, pathname: '/consultant', assign: push } });
  refresh.mockReset();
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
    { id: 'p0', role: 'user' as const, text: 'Разговор прошлой паузы', stepId: 'goal', paused: true as const },
    { id: 'b', role: 'user' as const, text: 'Что подтянуть до мидла?', stepId: 'documents', paused: true as const },
  ],
};

it('шаги — начало ленты, текущий вопрос не задаётся; разговор — тот же, без завершения онбординга', () => {
  render(<PausedFeed view={view} restored={restored} />);
  expect(screen.getByText('Ищу работу')).toBeDefined();
  expect(screen.getByText('Зачем цель?')).toBeDefined();
  // Кандидату нет режима «паузы» (решение владельца 11.10): ни плашки, ни кнопки возврата вверху.
  expect(screen.queryByTestId('ob-paused')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Вернуться к знакомству' })).toBeNull();
  // Прошлая пауза — под своим шагом (хронология), разговор этой паузы — в чате.
  expect(screen.getByText('Разговор прошлой паузы')).toBeDefined();
  expect(chatProps.last?.initial).toEqual({ conversationId: 'conv-1', items: [restored.items[2]] });
  expect((chatProps.last?.embedded as { beforeSend?: unknown }).beforeSend).toBeUndefined();
});

it('«Дополнить профиль» в чате — goto на следующий вопрос и перерисовка ленты; подпись совпадает с напоминанием консультанта', async () => {
  expect(FILL_LABEL).toBe(RESUME_BUTTON);
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...view, later: false }) }));
  vi.stubGlobal('fetch', fetchFn);
  render(<PausedFeed view={view} restored={restored} />);
  const embedded = chatProps.last?.embedded as { suggestions: { value: string; label: string }[]; onSuggestion: (v: string) => void };
  expect(embedded.suggestions[0]).toMatchObject({ value: 'resume', label: FILL_LABEL });
  act(() => embedded.onSuggestion('resume'));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(push).not.toHaveBeenCalled();
  const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toEqual({ action: 'goto', stepId: 'documents' });
});

it('работодатель: чат паузы - помощник по подбору; реплики прежних пауз под своим шагом, текущей - в чате', () => {
  const emp = {
    conversationId: 'e-1',
    items: [
      { id: 'p0', role: 'user' as const, text: 'Прошлая пауза', stepId: 'goal', paused: true as const },
      { id: 'p1', role: 'user' as const, text: 'Эта пауза', stepId: 'documents', paused: true as const },
    ],
  };
  render(<PausedFeed view={{ ...view, role: 'employer', scenario: 'employer' } as OnboardingView} employer={{ demoNoLlm: true, restored: emp }} />);
  expect(screen.getByText('Помощник по подбору')).toBeDefined();
  expect(screen.getByText('Прошлая пауза')).toBeDefined();
  expect(screen.queryByTestId('chat')).toBeNull();
  expect(assistantProps.last?.initial).toEqual({ conversationId: 'e-1', items: [emp.items[1]] });
  expect((assistantProps.last?.embedded as { beforeSend?: unknown }).beforeSend).toBeUndefined();
});

it('кандидату знакомство — таймлайн над чатом: «Продолжить» открывает вопрос в этой же ленте', async () => {
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...view, later: false }) }));
  vi.stubGlobal('fetch', fetchFn);
  render(<PausedFeed view={view} restored={restored} />);
  const strip = screen.getByTestId('onboarding-strip');
  expect(strip.textContent).toContain(`пройдено ${view.progress.done} из ${view.progress.total} вопрос`);
  act(() => screen.getByRole('button', { name: 'Продолжить' }).click());
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toEqual({ action: 'goto', stepId: 'documents' });
});

it('«Скрыть» убирает таймлайн целиком и помнит это; «Дополнить профиль» внизу остаётся способом продолжить', () => {
  localStorage.clear();
  render(<PausedFeed view={view} restored={restored} />);
  act(() => screen.getByRole('button', { name: 'Скрыть' }).click());
  expect(screen.queryByTestId('onboarding-strip')).toBeNull();
  expect((chatProps.last?.embedded as { pinned?: { label: string } }).pinned?.label).toBe(FILL_LABEL);
  cleanup();
  render(<PausedFeed view={view} restored={restored} />);
  expect(screen.queryByTestId('onboarding-strip')).toBeNull();
  localStorage.clear();
});
