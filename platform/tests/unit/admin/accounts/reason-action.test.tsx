import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ReasonAction } from '@/components/admin/actions/ReasonAction';

describe('ReasonAction: двойное подтверждение и причина', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('удаление: кнопка неактивна, пока id не введён вручную; в запрос уходят reason и confirm', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ erased: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    render(<ReasonAction label="Удалить" danger confirmText="user-1" submitLabel="Удалить навсегда" url="/api/admin/users/user-1/erase" method="POST" description="Необратимо" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const submit = screen.getByRole('button', { name: 'Удалить навсегда' });
    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: 'Запрос субъекта ПДн' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Для подтверждения введите: user-1/), { target: { value: 'user-2' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Для подтверждения введите: user-1/), { target: { value: 'user-1' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/users/user-1/erase');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Запрос субъекта ПДн', confirm: 'user-1' });
  });

  it('ошибка API показывается текстом сервера', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Недостаточно прав' } }), { status: 403 })));
    render(<ReasonAction label="Заблокировать" withUntil url="/x" method="POST" description="d" />);
    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать' }));
    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: 'Фейковый профиль' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Недостаточно прав');
  });
});
