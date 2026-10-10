import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountErasure } from '@/components/auth/AccountErasure';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('requires exact typed confirmation and allows cancellation without a request', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<AccountErasure />);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));
  const confirm = screen.getByRole('button', { name: 'Подтвердить удаление' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'удалить' } });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('explains withdrawal deletes both profiles, sends explicit intent and keeps failure retryable', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'conflict', message: 'Завершите созвон' } }), { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AccountErasure />);
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать согласие и удалить данные' }));
  expect(screen.getByText(/профили кандидата и работодателя/)).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'УДАЛИТЬ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить удаление' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Завершите созвон'));
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/account', expect.objectContaining({
    method: 'DELETE', body: JSON.stringify({ reason: 'withdraw', confirmation: 'УДАЛИТЬ' }),
  }));
  expect((screen.getByRole('button', { name: 'Подтвердить удаление' }) as HTMLButtonElement).disabled).toBe(false);
});
