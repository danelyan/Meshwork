import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Плашка «Онбординг не завершён»: кандидат продолжает в ленте /consultant (решение владельца 10.10).
const nav = vi.hoisted(() => ({ pathname: '/profile' }));
const me = vi.hoisted(() => ({ value: { role: 'candidate', onboarded: false } as { role: string; onboarded: boolean; onboardingProgress?: { done: number; total: number } | null } | null }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api', () => ({ getMe: () => Promise.resolve(me.value) }));

import { OnboardingBanner } from '@/components/shell/OnboardingBanner';

beforeEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    /* без хранилища */
  }
});
afterEach(cleanup);

it('кандидат: ссылка «продолжить» ведёт на /consultant', async () => {
  nav.pathname = '/profile';
  me.value = { role: 'candidate', onboarded: false };
  render(<OnboardingBanner />);
  await waitFor(() => expect(screen.getByRole('link', { name: 'продолжить' }).getAttribute('href')).toBe('/consultant'));
});

it('на самой /consultant плашки нет: шаги знакомства уже в ленте', async () => {
  nav.pathname = '/consultant';
  me.value = { role: 'candidate', onboarded: false };
  render(<OnboardingBanner />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole('status')).toBeNull();
});

it('работодатель тоже продолжает в ленте /consultant (один адрес с чатом)', async () => {
  nav.pathname = '/employer';
  me.value = { role: 'employer', onboarded: false };
  render(<OnboardingBanner />);
  await waitFor(() => expect(screen.getByRole('link', { name: 'продолжить' }).getAttribute('href')).toBe('/consultant'));
});

it('показывает «заполнено N из M» и ссылку на ленту', async () => {
  nav.pathname = '/profile';
  me.value = { role: 'candidate', onboarded: false, onboardingProgress: { done: 3, total: 12 } };
  render(<OnboardingBanner />);
  expect(await screen.findByText(/Знакомство: заполнено 3 из 12/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'продолжить' }).getAttribute('href')).toBe('/consultant');
});

it('без прогресса остаётся прежний текст без чисел', async () => {
  nav.pathname = '/profile';
  me.value = { role: 'candidate', onboarded: false, onboardingProgress: null };
  render(<OnboardingBanner />);
  expect(await screen.findByText(/Онбординг не завершён/)).toBeTruthy();
});

it('крестик скрывает плашку и помнит это до следующего входа (sessionStorage)', async () => {
  nav.pathname = '/profile';
  me.value = { role: 'candidate', onboarded: false, onboardingProgress: { done: 3, total: 12 } };
  const { unmount } = render(<OnboardingBanner />);
  fireEvent.click(await screen.findByRole('button', { name: 'Скрыть' }));
  expect(screen.queryByRole('status')).toBeNull();
  unmount();
  render(<OnboardingBanner />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole('status')).toBeNull();
});

it('у завершённого онбординга плашки нет', async () => {
  nav.pathname = '/profile';
  me.value = { role: 'candidate', onboarded: true, onboardingProgress: null };
  render(<OnboardingBanner />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole('status')).toBeNull();
});
