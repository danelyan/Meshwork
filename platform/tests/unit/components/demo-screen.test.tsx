import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DEMO_FEATURES, DemoScreen } from '@/components/DemoScreen';
import { ALL_PERSONAS } from '@/server/demo/personas';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

const push = vi.fn();
// Вход и переходы - полная навигация (window.location.assign), см. useDemoPersonas.
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: push } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

function stubFetch(login: unknown) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (init?.method === 'POST' ? login : { personas: ALL_PERSONAS, candidates: [], employers: [] }),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

it('персоны: этапы 1…8 без дублей, у каждой одна строка «что увидишь»', () => {
  const stages = ALL_PERSONAS.filter((p) => p.stage !== null).map((p) => p.stage);
  expect(stages).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(new Set(ALL_PERSONAS.map((p) => p.id)).size).toBe(ALL_PERSONAS.length);
  for (const p of ALL_PERSONAS) expect(p.sees.length).toBeGreaterThan(20);
  const ids = new Set(ALL_PERSONAS.map((p) => p.id));
  for (const f of DEMO_FEATURES) for (const id of f.personas) expect(ids.has(id)).toBe(true);
});

it('показывает 6 пунктов и быстрый вход персоной под каждым', async () => {
  stubFetch({});
  render(<DemoScreen />);
  expect((await screen.findAllByRole('button', { name: 'Войти как Юлия Власова' })).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(DEMO_FEATURES.length);
});

it('работодатель ведёт по ссылке next в /employer, кандидат с таким next - в свой кабинет', async () => {
  const fetchFn = stubFetch({ employer: { id: 'demo-employer', name: 'x' }, candidate: { id: 'c', name: 'y' }, next: '/consultant' });
  render(<DemoScreen next="/employer/search" />);
  // первый такой чип – шаг маршрута жюри со своим `to` (/employer); чип карточки фич ниже идёт по общему next
  fireEvent.click((await screen.findAllByRole('button', { name: 'Войти как Анна Кравец · Т-Банк' })).at(-1)!);
  await waitFor(() => expect(push).toHaveBeenCalledWith('/employer/search'));
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ employerUserId: 'demo-employer' });
});

it('кандидат с next на кабинет работодателя входит в свой кабинет', async () => {
  stubFetch({ candidate: { id: 'c', name: 'y' }, next: '/consultant' });
  render(<DemoScreen next="/employer/search" />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Войти как Марина Котова' }))[0]!);
  await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
});

it('«Новый пользователь»: без галки согласия неактивен; с галкой создаёт гостя с версией согласия', async () => {
  const fetchFn = stubFetch({ user: { id: 'u', name: 'Демо-гость 1' }, next: '/consultant' });
  render(<DemoScreen />);
  const btn = (await screen.findAllByRole('button', { name: 'Новый пользователь' }))[0] as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /Согласен\(на\) на обработку персональных данных/ }));
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ fresh: true, consent: CONSENT_VERSION });
});
