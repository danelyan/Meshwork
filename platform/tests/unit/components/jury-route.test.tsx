import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DemoScreen } from '@/components/DemoScreen';
import { JURY_PAGES } from '@/components/demo/jury';
import { JURY_ROUTE } from '@/components/demo/JuryRoute';
import { Hero } from '@/components/landing/Hero';
import { EvaluateScreen } from '@/components/validation/EvaluateScreen';
import { ALL_PERSONAS } from '@/server/demo/personas';

vi.mock('@/components/landing/HeroGraph', () => ({ HeroGraph: () => null }));
const assign = vi.fn();
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => ({
    ok: true, status: 200,
    json: async () => (init?.method === 'POST' ? { employer: { id: 'e', name: 'x' }, candidate: { id: 'c', name: 'y' }, next: '/employer' } : { personas: ALL_PERSONAS }),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); assign.mockReset(); });

it('маршрут: шаги ссылаются на существующие персоны и содержат критерий', () => {
  const ids = new Set(ALL_PERSONAS.map((p) => p.id));
  expect(JURY_ROUTE.length).toBeGreaterThanOrEqual(4);
  expect(JURY_ROUTE.length).toBeLessThanOrEqual(6);
  for (const s of JURY_ROUTE) {
    expect(s.persona || s.link).toBeTruthy();
    if (s.persona) { expect(ids.has(s.persona.id)).toBe(true); expect(s.persona.to.startsWith('/')).toBe(true); }
    expect(s.criterion).toMatch(/%/);
  }
});

it('/demo: маршрут, карточки страниц жюри и вход персоной шага ведёт в свой раздел', async () => {
  render(<DemoScreen />);
  const route = screen.getByRole('heading', { name: 'Маршрут жюри на 5 минут' }).closest('section')!;
  fireEvent.click((await within(route).findAllByRole('button', { name: 'Войти как Анна Кравец · Северный Поток' }))[0]!);
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/employer'));
  const pages = screen.getByRole('heading', { name: 'Проверить наши цифры и механику' }).closest('section')!;
  for (const p of JURY_PAGES) expect(within(pages).getByRole('link', { name: `${p.title} →` }).getAttribute('href')).toBe(p.href);
  expect(JURY_PAGES.map((p) => p.href)).toEqual(['/method', '/validation', '/evaluate', '/mechanics', '/simulator', '/expert']);
});

it('лендинг: «Для жюри» только при demoEnabled', () => {
  render(<Hero signedIn={false} />);
  expect(screen.queryByRole('link', { name: /Для жюри/ })).toBeNull();
  cleanup();
  render(<Hero signedIn={false} demoEnabled />);
  expect(screen.getByRole('link', { name: /Для жюри/ }).getAttribute('href')).toBe('/demo');
});

it('/evaluate: обратная ссылка на /demo только при juryLink', () => {
  const props = { sample: { k: 5, vacancies: [], candidates: [], relevance: {} } as never, catalog: [], limits: { bodyBytes: 1024, vacancies: 1, candidates: 1, kMax: 5 } as never };
  render(<EvaluateScreen {...props} />);
  expect(screen.queryByRole('link', { name: '← Все страницы для жюри' })).toBeNull();
  cleanup();
  render(<EvaluateScreen {...props} juryLink />);
  expect(screen.getByRole('link', { name: '← Все страницы для жюри' }).getAttribute('href')).toBe('/demo');
});
