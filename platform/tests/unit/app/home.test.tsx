import { cleanup, render, screen, waitFor } from '@testing-library/react';

import HomePage from '@/app/page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body })));
}

it('главная: заголовок, пометка демо и список кандидатов', async () => {
  stubFetch({ candidates: [{ id: 'd1', name: 'Анна', specialization: 'backend', fspState: 'linked' }] });
  render(<HomePage />);
  expect(screen.getByRole('heading', { level: 1, name: 'ФСП Карьера' })).toBeDefined();
  expect(screen.getByText('демо-стенд')).toBeDefined();
  await waitFor(() => expect(screen.getByRole('button', { name: /Анна/ })).toBeDefined());
});

it('главная: ошибка загрузки видна', async () => {
  stubFetch({ error: { code: 'forbidden', message: 'Демо-вход выключен' } }, false);
  render(<HomePage />);
  expect((await screen.findByRole('alert')).textContent).toBe('Демо-вход выключен');
});
