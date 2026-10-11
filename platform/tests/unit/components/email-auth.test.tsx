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
    const view = render(<EmailAuth next={null} navigate={navigate} agreed={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Регистрация' }));
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'jury@example.test' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password' } });
    const submit = screen.getByRole('button', { name: 'Получить код' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: 'Вход по почте' }));
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(<EmailAuth next={null} navigate={navigate} agreed />);
    fireEvent.click(submit);

    expect((await screen.findByText(/Локальная разработка/)).textContent).toContain('042137');
    fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '042137' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить почту' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant'));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ email: 'jury@example.test', code: '042137' });
  });

  it('вход: 401 показывает текст ошибки сервера, а не «сессия закончилась»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: { code: 'invalid_credentials', message: 'Неверная почта или пароль' } })));
    render(<EmailAuth next={null} navigate={vi.fn()} agreed={false} />);
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти по почте' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Неверная почта или пароль');
  });

  it('password reset opens from the lower link, resends the code and completes without new consent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { sent: true }))
      .mockResolvedValueOnce(json(200, { sent: true }))
      .mockResolvedValueOnce(json(400, { error: { code: 'invalid_code', message: 'Код не подошёл' } }))
      .mockResolvedValueOnce(json(200, { next: '/profile' }));
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    render(<EmailAuth next="/profile" navigate={navigate} agreed={false} />);
    const modes = screen.getByRole('group', { name: 'Способ' });
    expect(modes.querySelectorAll('button')).toHaveLength(2);
    expect(modes.contains(screen.getByRole('button', { name: 'Забыли пароль?' }))).toBe(false);
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'reset@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
    expect(screen.queryByLabelText('Пароль')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Прислать код' }));
    await screen.findByLabelText('Код из письма');
    fireEvent.click(screen.getByRole('button', { name: 'Прислать код ещё раз' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'replacement-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль и войти' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Код не подошёл');
    fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль и войти' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/profile'));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/password/forgot');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/password/forgot');
    expect(fetchMock.mock.calls[3]![0]).toBe('/api/auth/password/reset');
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ email: 'reset@example.test', code: '654321', password: 'replacement-password', next: '/profile' });
  });

  it('reset can return to login and does not create an account', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<EmailAuth next={null} navigate={vi.fn()} agreed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }));
    expect(screen.getByRole('button', { name: 'Войти по почте' })).toBeTruthy();
    expect(screen.queryByLabelText('Новый пароль')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
