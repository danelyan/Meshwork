import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DemoScreen } from '@/components/DemoScreen';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

const push = vi.fn();
// Вход и переходы — полная навигация (window.location.assign), см. DemoScreen.enter.
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: push } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

const LIST = {
  candidates: [{ id: 'd1', name: 'Анна', specialization: 'backend', fspState: 'linked' }],
  employers: [{ id: 'e1', name: 'Олег HR', company: { id: 'co', name: 'Гранит' } }],
};

function stubFetch(login: unknown) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (init?.method === 'POST' ? login : LIST),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

it('показывает демо-кандидатов и работодателей', async () => {
  stubFetch({});
  render(<DemoScreen />);
  expect(await screen.findByRole('button', { name: 'Войти как Анна' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Войти как Олег HR' })).toBeDefined();
  expect(screen.getByText(/Гранит/)).toBeDefined();
});

it('демо-работодатель: вход ведёт в /employer', async () => {
  const fetchFn = stubFetch({ employer: { id: 'e1', name: 'Олег HR' }, next: '/employer' });
  render(<DemoScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Войти как Олег HR' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/employer'));
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ employerUserId: 'e1' });
});

it('кандидаты пула работодателя свёрнуты в «ещё N кандидатов для подборки», основной список короткий', async () => {
  const pool = Array.from({ length: 8 }, (_, i) => ({ id: `demo-pool-${i}`, name: `Пул ${i}`, specialization: 'backend', fspState: 'linked' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [...LIST.candidates, ...pool], employers: LIST.employers }) })),
  );
  render(<DemoScreen />);
  await screen.findByRole('button', { name: 'Войти как Анна' });
  const summary = screen.getByText('ещё 8 кандидатов для подборки');
  const details = summary.closest('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelectorAll('button[aria-label^="Войти"]')).toHaveLength(8);
  expect(summary.closest('section')!.querySelectorAll('ul > li > button[aria-label^="Войти"]')).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'Войти как Анна' }).closest('details')).toBeNull();
});

it('«Новый пользователь»: без галки согласия кнопка неактивна; с галкой создаёт гостя с версией согласия и ведёт на /onboarding', async () => {
  const fetchFn = stubFetch({ user: { id: 'u', name: 'Демо-гость 1' }, next: '/onboarding' });
  render(<DemoScreen />);
  await screen.findByRole('button', { name: 'Войти как Анна' });
  const btn = screen.getByRole('button', { name: 'Новый пользователь' }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(screen.getByRole('link', { name: 'полный текст' }).getAttribute('href')).toBe('/consent');
  fireEvent.click(screen.getByRole('checkbox', { name: /Согласен\(на\) на обработку персональных данных/ }));
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ fresh: true, consent: CONSENT_VERSION });
});

it('«пройти онбординг заново» у демо-кандидата шлёт restartCandidateId', async () => {
  const fetchFn = stubFetch({ user: { id: 'u', name: 'x' }, next: '/onboarding' });
  render(<DemoScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Пройти онбординг заново: Анна' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ restartCandidateId: 'd1' });
});

it('«пройти онбординг заново» у демо-работодателя шлёт restartUserId', async () => {
  const fetchFn = stubFetch({ user: { id: 'u', name: 'x' }, next: '/onboarding' });
  render(<DemoScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Пройти онбординг заново: Олег HR' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
  expect(JSON.parse(String(fetchFn.mock.calls[1]![1]!.body))).toEqual({ restartUserId: 'e1' });
});

describe('?next= от guard', () => {
  it('кандидат: вход ведёт на исходную страницу кандидата', async () => {
    stubFetch({ candidate: { id: 'd1', name: 'Анна' }, next: '/consultant' });
    render(<DemoScreen next="/test?specialization=backend" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти как Анна' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/test?specialization=backend'));
  });

  it('кандидат с next на кабинет работодателя — в свой кабинет', async () => {
    stubFetch({ candidate: { id: 'd1', name: 'Анна' }, next: '/consultant' });
    render(<DemoScreen next="/employer/search" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти как Анна' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
  });

  it('работодатель: next /employer/… — туда, страница кандидата — в /employer', async () => {
    stubFetch({ employer: { id: 'e1', name: 'Олег HR' }, next: '/employer' });
    render(<DemoScreen next="/employer/search" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти как Олег HR' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/employer/search'));
    cleanup();
    push.mockReset();
    render(<DemoScreen next="/profile" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти как Олег HR' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/employer'));
  });

  it('«пройти онбординг заново» next не использует', async () => {
    stubFetch({ user: { id: 'u', name: 'x' }, next: '/onboarding' });
    render(<DemoScreen next="/profile" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Пройти онбординг заново: Анна' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
  });
});
