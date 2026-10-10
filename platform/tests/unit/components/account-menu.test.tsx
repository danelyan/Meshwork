import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccountMenu, initialsOf } from '@/components/shell/AccountMenu';
import { ApiError, demoLogout, switchRoleApi } from '@/lib/api';
import type { RoleMenu } from '@/server/auth/role-plan';

const nav = vi.hoisted(() => ({ pathname: '/consultant' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), switchRoleApi: vi.fn(), demoLogout: vi.fn() }));

const navigate = vi.fn();
const user = { userName: 'Иван Петров', userEmail: 'ivan@example.ru' };
const candidate: RoleMenu = { role: 'candidate', companyName: null, other: 'employer', otherExists: true, canCreateOther: false, ...user };
const employer: RoleMenu = { role: 'employer', companyName: 'ООО Ромашка', other: 'candidate', otherExists: true, canCreateOther: false, ...user };

const trigger = () => screen.getByRole('button', { name: /Аккаунт, активная роль/ });
const openMenu = (menu: RoleMenu) => {
  render(<AccountMenu menu={menu} navigate={navigate} />);
  fireEvent.click(trigger());
};

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/consultant';
  vi.mocked(switchRoleApi).mockResolvedValue({ role: 'employer', next: '/consultant', created: false, changed: true });
  vi.mocked(demoLogout).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('initialsOf', () => {
  it('два слова, одно слово, пусто → почта', () => {
    expect(initialsOf('Иван Петров', null)).toBe('ИП');
    expect(initialsOf('  ivan ', null)).toBe('I');
    expect(initialsOf('', 'z@x.ru')).toBe('Z');
  });
});

describe('AccountMenu', () => {
  it('кнопка: инициалы и роль, меню закрыто; открытие показывает имя, почту, роли; Escape возвращает фокус', () => {
    render(<AccountMenu menu={employer} navigate={navigate} />);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toContain('ИП');
    expect(screen.queryByText('ivan@example.ru')).toBeNull();
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(trigger().getAttribute('aria-controls')!)).toBeTruthy();
    expect(screen.getByText('ivan@example.ru')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Работодатель · ООО Ромашка/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Кандидат' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Профиль компании' }).getAttribute('href')).toBe('/employer/company');
    screen.getByRole('button', { name: 'Кандидат' }).focus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Кандидат' }), { key: 'Escape' });
    expect(screen.queryByText('ivan@example.ru')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('клик вне закрывает; у кандидата нет «Профиль компании»', () => {
    openMenu(candidate);
    expect(screen.queryByRole('link', { name: 'Профиль компании' })).toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('ivan@example.ru')).toBeNull();
  });

  it('переход по ссылке (смена pathname) закрывает меню', () => {
    const { rerender } = render(<AccountMenu menu={employer} navigate={navigate} />);
    fireEvent.click(trigger());
    nav.pathname = '/employer/company';
    rerender(<AccountMenu menu={employer} navigate={navigate} />);
    expect(screen.queryByText('ivan@example.ru')).toBeNull();
  });

  it('↑/↓ ходят по пунктам по кругу', () => {
    openMenu(employer);
    const first = screen.getByRole('button', { name: /Работодатель · ООО Ромашка/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Кандидат' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Выйти' }));
  });

  it('второй профиль есть: клик по неактивной роли → API и полная навигация на next', async () => {
    openMenu(candidate);
    fireEvent.click(screen.getByRole('button', { name: 'Работодатель' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant'));
    expect(switchRoleApi).toHaveBeenCalledWith({ role: 'employer' });
  });

  it('клик по активной роли ничего не делает', () => {
    openMenu(candidate);
    fireEvent.click(screen.getByRole('button', { name: /Кандидат/ }));
    expect(switchRoleApi).not.toHaveBeenCalled();
  });

  it('работодатель без профиля кандидата: сначала подтверждение, потом API', async () => {
    openMenu({ ...employer, otherExists: false, canCreateOther: true });
    fireEvent.click(screen.getByRole('button', { name: 'Кандидат' }));
    expect(switchRoleApi).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: 'Стать кандидатом' }).textContent).toContain('профиль кандидата');
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant'));
    expect(switchRoleApi).toHaveBeenCalledWith({ role: 'candidate' });
  });

  it('кандидат без профиля работодателя: компания от 2 символов (aria-invalid), затем API с названием', async () => {
    openMenu({ ...candidate, otherExists: false, canCreateOther: true });
    fireEvent.click(screen.getByRole('button', { name: 'Работодатель' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    const input = screen.getByLabelText('Название компании');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toContain('от 2 символов');
    expect(switchRoleApi).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  ООО Ромашка ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant'));
    expect(switchRoleApi).toHaveBeenCalledWith({ role: 'employer', companyName: 'ООО Ромашка' });
  });

  it('«Отмена» закрывает шаг подтверждения, меню остаётся', () => {
    openMenu({ ...candidate, otherExists: false, canCreateOther: true });
    fireEvent.click(screen.getByRole('button', { name: 'Работодатель' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('ivan@example.ru')).toBeTruthy();
  });

  it('общий демо-аккаунт: вторая роль неактивна с пояснением', () => {
    openMenu({ ...candidate, otherExists: false, canCreateOther: false });
    const item = screen.getByRole('button', { name: /Работодатель/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain('Недоступно на демо-аккаунте');
    fireEvent.click(item);
    expect(switchRoleApi).not.toHaveBeenCalled();
  });

  it('двойной клик по роли — один запрос', () => {
    vi.mocked(switchRoleApi).mockReturnValue(new Promise(() => undefined));
    openMenu(candidate);
    const btn = screen.getByRole('button', { name: 'Работодатель' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(switchRoleApi).toHaveBeenCalledTimes(1);
  });

  it('ошибка API — текст ошибки, навигации нет', async () => {
    vi.mocked(switchRoleApi).mockRejectedValue(new ApiError('Слишком много переключений', 429, 'rate_limited'));
    openMenu(candidate);
    fireEvent.click(screen.getByRole('button', { name: 'Работодатель' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Слишком много переключений'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('«Выйти» вызывает demoLogout и ведёт на главную', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    openMenu(candidate);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(demoLogout).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
