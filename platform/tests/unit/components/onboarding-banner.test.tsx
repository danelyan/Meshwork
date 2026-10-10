import { cleanup, render, screen, waitFor } from '@testing-library/react';

// Плашка «Онбординг не завершён»: кандидат продолжает в ленте /consultant (решение владельца 10.10).
const nav = vi.hoisted(() => ({ pathname: '/profile' }));
const me = vi.hoisted(() => ({ value: { role: 'candidate', onboarded: false } as { role: string; onboarded: boolean } | null }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api', () => ({ getMe: () => Promise.resolve(me.value) }));

import { OnboardingBanner } from '@/components/shell/OnboardingBanner';

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

it('работодатель: продолжает на /onboarding', async () => {
  nav.pathname = '/employer';
  me.value = { role: 'employer', onboarded: false };
  render(<OnboardingBanner />);
  await waitFor(() => expect(screen.getByRole('link', { name: 'продолжить' }).getAttribute('href')).toBe('/onboarding'));
});
