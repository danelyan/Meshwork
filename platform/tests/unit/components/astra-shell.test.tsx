import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DashboardFrame } from '@/components/shell/DashboardFrame';
import { OnboardingDraft } from '@/components/onboarding/OnboardingDraft';
import type { HeaderAccount } from '@/server/auth/role-plan';
import type { OnboardingView } from '@/server/onboarding/types';

const nav = vi.hoisted(() => ({ pathname: '/career' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/api', () => ({ demoLogout: vi.fn() }));
afterEach(cleanup);

const account: HeaderAccount = { userName: 'Тестовый пользователь', userEmail: null, roles: { role: 'candidate', other: 'employer', otherExists: false, canCreateOther: true, companyName: null } };

it('keeps the consultant full width and hides role navigation from guests', () => {
  nav.pathname = '/consultant';
  const view = render(<DashboardFrame account={account}><p>Разговор</p></DashboardFrame>);
  expect(screen.queryByRole('navigation', { name: 'Разделы кабинета' })).toBeNull();
  nav.pathname = '/career';
  view.rerender(<DashboardFrame><p>Вход</p></DashboardFrame>);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('marks only current dashboard route and keeps employer routes out of candidate navigation', () => {
  nav.pathname = '/projects/task-1';
  render(<DashboardFrame account={account}><p>Задание</p></DashboardFrame>);
  expect(screen.getByRole('link', { name: 'Проекты' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('link', { name: 'Вакансии' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Моя карта' }).getAttribute('href')).toBe('/career');
});

it('draft edits use actual step IDs; privacy view does not repeat personal answers', async () => {
  const view: OnboardingView = {
    name: 'Тест', role: 'candidate', scenario: 'candidate', consent: { version: '1', docUrl: '/consent' },
    progress: { done: 1, total: 5 }, history: [{ stepId: 'candidateContact', label: 'Контакт', lead: '', question: '', answer: 'private@example.com', editable: true }],
    current: { id: 'stack', label: 'Стек', kind: 'chips', question: 'Стек?', lead: '', eyebrow: '', allowCustom: true, required: false },
    summary: null, laterTarget: '/consultant', test: { href: '/test', ready: true }, onboarded: false,
  };
  const edit = vi.fn();
  render(<OnboardingDraft view={view} busy={false} onEdit={edit} />);
  expect(screen.queryByText('private@example.com')).toBeNull();
  fireEvent.click(screen.getByText('Черновик профиля'));
  await waitFor(() => expect(screen.getByText('private@example.com')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Изменить: Контакт' }));
  expect(edit).toHaveBeenCalledWith('candidateContact');
  fireEvent.click(screen.getByRole('button', { name: 'Кто увидит' }));
  expect(screen.queryByText('private@example.com')).toBeNull();
  expect(screen.getByRole('link', { name: 'Текст согласия' }).getAttribute('href')).toBe('/consent');
});
