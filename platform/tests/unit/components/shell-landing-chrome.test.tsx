import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';

import { ShellFrame } from '@/components/shell/ShellFrame';

const route = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
vi.mock('@/components/shell/theme', () => ({ useThemeRoot: vi.fn() }));
vi.mock('@/components/ui/MotionProvider', () => ({ MotionProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/shell/DashboardFrame', () => ({ DashboardFrame: ({ children }: { children: ReactNode }) => children }));

afterEach(cleanup);

it.each(['/', '/auth'])('does not double the landing chrome on %s', path => {
  route.path = path;
  render(<ShellFrame header={<header>Общая шапка</header>} footer={<footer>Общий подвал</footer>}><main id="main">Страница</main></ShellFrame>);
  expect(screen.queryByText('Общая шапка')).toBeNull();
  expect(screen.queryByText('Общий подвал')).toBeNull();
  expect(screen.getByRole('main').textContent).toBe('Страница');
  expect(screen.getByRole('link', { name: 'К содержимому' }).getAttribute('href')).toBe('#main');
});

it('retains shared header and footer on consultant', () => {
  route.path = '/consultant';
  render(<ShellFrame header={<header>Общая шапка</header>} footer={<footer>Общий подвал</footer>}><main id="main">Консультант</main></ShellFrame>);
  expect(screen.getByRole('banner').textContent).toBe('Общая шапка');
  expect(screen.getByRole('contentinfo').textContent).toBe('Общий подвал');
});
