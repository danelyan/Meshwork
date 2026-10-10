import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EmailAuth } from '@/components/auth/EmailAuth';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('EmailAuth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('регистрация: без галки согласия кнопка неактивна; локальный код показывается; код → переход', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { sent: true, devCode: '042137' }))
      .mockResolvedValueOnce(json(200, { next: '/consultant' }));
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    render(<EmailAuth next={null} navigate={navigate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Регистрация' }));
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'jury@example.test' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password' } });
    const submit = screen.getByRole('button', { name: 'Получить код' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);

    expect((await screen.findByText(/Локальная разработка/)).textContent).toContain('042137');
    fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '042137' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить почту' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant'));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ email: 'jury@example.test', code: '042137' });
  });

  it('вход: 401 показывает текст ошибки сервера, а не «сессия закончилась»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: { code: 'invalid_credentials', message: 'Неверная почта или пароль' } })));
    render(<EmailAuth next={null} navigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти по почте' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Неверная почта или пароль');
  });
});
