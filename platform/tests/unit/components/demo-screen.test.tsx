import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DemoScreen } from '@/components/DemoScreen';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

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
  expect(details.querySelectorAll('button')).toHaveLength(8);
  expect(summary.closest('section')!.querySelectorAll('ul > li > button')).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'Войти как Анна' }).closest('details')).toBeNull();
});
