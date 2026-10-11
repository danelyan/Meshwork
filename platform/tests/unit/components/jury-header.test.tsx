import { cleanup, render, screen } from '@testing-library/react';

import { isJuryPath } from '@/components/demo/jury';
import { HeaderBar } from '@/components/shell/HeaderBar';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/lib/api', () => ({ demoLogout: vi.fn(), getMe: () => Promise.resolve({ onboarded: true }), switchRoleApi: vi.fn() }));

afterEach(cleanup);

it('«Для жюри» в шапке ведёт на /demo и есть только при DEMO_LOGIN', () => {
  nav.pathname = '/';
  render(<HeaderBar signedIn={false} links={[]} jury />);
  expect(screen.getByRole('link', { name: 'Для жюри' }).getAttribute('href')).toBe('/demo');
  cleanup();
  render(<HeaderBar signedIn={false} links={[]} />);
  expect(screen.queryByRole('link', { name: 'Для жюри' })).toBeNull();
});

it('«Для жюри» активна на хабе и страницах жюри, не активна в кабинете', () => {
  nav.pathname = '/simulator';
  render(<HeaderBar signedIn={false} links={[]} jury />);
  expect(screen.getByRole('link', { name: 'Для жюри' }).getAttribute('aria-current')).toBe('page');
  for (const p of ['/demo', '/validation', '/evaluate', '/mechanics', '/expert']) expect(isJuryPath(p)).toBe(true);
  for (const p of ['/', '/consultant', '/employer', '/demonstration']) expect(isJuryPath(p)).toBe(false);
});
