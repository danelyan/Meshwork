import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardFrame } from '@/components/shell/DashboardFrame';
import { OnboardingDraft } from '@/components/onboarding/OnboardingDraft';
import type { HeaderAccount } from '@/server/auth/role-plan';
import type { OnboardingView } from '@/server/onboarding/types';

const nav = vi.hoisted(() => ({ pathname: '/career' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/components/candidate/CandidateSidebarSummary', () => ({ CandidateSidebarSummary: () => null }));
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
  nav.pathname = '/skills';
  render(<DashboardFrame account={account}><p>Задание</p></DashboardFrame>);
  expect(screen.getByRole('link', { name: 'Навыки и грейд' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('link', { name: 'Проекты' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Поиск по базе' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Вакансии' }).getAttribute('href')).toBe('/career');
});

it('sidebar: candidate order follows the journey stages, employer labels match the header', () => {
  nav.pathname = '/career';
  const view = render(<DashboardFrame account={account}><p>x</p></DashboardFrame>);
  const names = () => within(screen.getByRole('navigation', { name: 'Разделы кабинета' })).getAllByRole('link').map((a) => a.textContent?.replace(/^\S\s?/, ''));
  // Пункты шапки (header: true) в сайдбаре не повторяются.
  expect(names()).toEqual(['Навыки и грейд', 'Вакансии', 'Созвон с ИИ', 'Избранное', 'Настройки']);
  expect(screen.getByRole('link', { name: 'Вакансии' }).getAttribute('aria-current')).toBe('page');
  view.unmount();
  nav.pathname = '/employer/needs/n1';
  render(<DashboardFrame account={{ ...account, roles: { ...account.roles!, role: 'employer' } }}><p>x</p></DashboardFrame>);
  expect(names()).toEqual(['Избранное', 'Компания']);
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
  expect(screen.getByText('private@example.com')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Изменить: Контакт' }));
  expect(edit).toHaveBeenCalledWith('candidateContact');
  fireEvent.click(screen.getByRole('button', { name: 'Как видит компания' }));
  expect(screen.queryByText('private@example.com')).toBeNull();
  expect(screen.getByText(/АНОНИМНАЯ КАРТОЧКА/)).toBeTruthy();
});
