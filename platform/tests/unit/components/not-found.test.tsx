import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';

import NotFound from '@/app/not-found';

const probe = vi.hoisted(() => ({ bare: vi.fn(), surface: vi.fn() }));
vi.mock('@/components/shell/ShellFrame', () => ({ useBareShell: probe.bare }));
vi.mock('@/components/avatar/OvalHead', () => ({ OvalHead: (props: unknown) => { probe.surface(props); return <div data-testid="404-head" />; } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); probe.surface.mockClear(); });

it('keeps the return link and error readable without depending on the avatar', () => {
  render(<NotFound />);
  expect(screen.getByRole('heading', { name: 'Даже он не знает, где эта страница.' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'На главную' }).getAttribute('href')).toBe('/');
  expect(probe.bare).toHaveBeenCalledWith(true);
  expect(probe.surface).toHaveBeenLastCalledWith(expect.objectContaining({ avoidPointer: true }));
});

it('responds to reduced-motion changes and removes the subscription', () => {
  let listener = () => {};
  const media = { matches: true, addEventListener: vi.fn((_event: string, cb: () => void) => { listener = cb; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => media);
  const view = render(<NotFound />);
  expect(probe.surface).toHaveBeenLastCalledWith(expect.objectContaining({ reducedMotion: true }));
  act(() => { media.matches = false; listener(); });
  expect(probe.surface).toHaveBeenLastCalledWith(expect.objectContaining({ reducedMotion: false }));
  act(() => { media.matches = true; listener(); });
  expect(probe.surface).toHaveBeenLastCalledWith(expect.objectContaining({ reducedMotion: true }));
  view.unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  vi.unstubAllGlobals();
});
