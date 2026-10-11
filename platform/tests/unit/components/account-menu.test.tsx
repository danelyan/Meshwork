import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccountMenu, initialsOf } from '@/components/shell/AccountMenu';
import { LogoutButton } from '@/components/shell/LogoutButton';
import { ApiError, logout, switchRoleApi } from '@/lib/api';
import type { HeaderAccount, RoleMenu } from '@/server/auth/role-plan';

const nav = vi.hoisted(() => ({ pathname: '/consultant' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), switchRoleApi: vi.fn(), logout: vi.fn() }));

const navigate = vi.fn();
const user = { userName: 'Иван Петров', userEmail: 'ivan@example.ru' };
const candidate: RoleMenu = { role: 'candidate', companyName: null, other: 'employer', otherExists: true, canCreateOther: false };
const employer: RoleMenu = { role: 'employer', companyName: 'ООО Ромашка', other: 'candidate', otherExists: true, canCreateOther: false };

const acc = (roles: RoleMenu | null): HeaderAccount => ({ ...user, roles });

const trigger = () => screen.getByRole('button', { name: /Аккаунт, активная роль/ });
const openMenu = (menu: RoleMenu) => {
  render(<AccountMenu account={acc(menu)} navigate={navigate} />);
  fireEvent.click(trigger());
};

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/consultant';
  vi.mocked(switchRoleApi).mockResolvedValue({ role: 'employer', next: '/consultant', created: false, changed: true });
  vi.mocked(logout).mockResolvedValue({ ok: true });
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
    render(<AccountMenu account={acc(employer)} navigate={navigate} />);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toContain('ООО Ромашка');
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
    const { rerender } = render(<AccountMenu account={acc(employer)} navigate={navigate} />);
    fireEvent.click(trigger());
    nav.pathname = '/employer/company';
    rerender(<AccountMenu account={acc(employer)} navigate={navigate} />);
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
    fireEvent.click(screen.getByRole('button', { name: /^Кандидат \(активная/ }));
    expect(switchRoleApi).not.toHaveBeenCalled();
  });

  it('работодатель без профиля кандидата: сначала подтверждение, потом API', async () => {
    openMenu({ ...employer, otherExists: false, canCreateOther: true });
    expect(screen.queryByRole('group', { name: 'Роль' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ищу работу - создать профиль кандидата' }));
    expect(switchRoleApi).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: 'Стать кандидатом' }).textContent).toContain('профиль кандидата');
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant'));
    expect(switchRoleApi).toHaveBeenCalledWith({ role: 'candidate' });
  });

  it('кандидат без профиля работодателя: компания от 2 символов (aria-invalid), затем API с названием', async () => {
    openMenu({ ...candidate, otherExists: false, canCreateOther: true });
    fireEvent.click(screen.getByRole('button', { name: 'Я ещё и нанимаю - создать компанию' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Я ещё и нанимаю - создать компанию' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('ivan@example.ru')).toBeTruthy();
  });

  it('общий демо-аккаунт без второго профиля: ни переключателя, ни пункта «создать…»', () => {
    openMenu({ ...candidate, otherExists: false, canCreateOther: false });
    expect(screen.queryByRole('group', { name: 'Роль' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Работодатель|создать/ })).toBeNull();
  });

  it('оба профиля есть: переключатель ролей, пункта «создать…» нет', () => {
    openMenu(candidate);
    expect(screen.getByRole('group', { name: 'Роль' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /создать/ })).toBeNull();
  });

  it('двойной клик по роли – один запрос', () => {
    vi.mocked(switchRoleApi).mockReturnValue(new Promise(() => undefined));
    openMenu(candidate);
    const btn = screen.getByRole('button', { name: 'Работодатель' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(switchRoleApi).toHaveBeenCalledTimes(1);
  });

  it('ошибка API – текст ошибки, навигации нет', async () => {
    vi.mocked(switchRoleApi).mockRejectedValue(new ApiError('Слишком много переключений', 429, 'rate_limited'));
    openMenu(candidate);
    fireEvent.click(screen.getByRole('button', { name: 'Работодатель' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Слишком много переключений'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('«Выйти» выходит через POST /api/auth/logout (не демо-маршрут) и ведёт на главную', async () => {
    const assign = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    vi.stubGlobal('fetch', fetcher);
    openMenu(candidate);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('кнопка «Выйти» в шапке гостя (LogoutButton) выходит тем же маршрутом', async () => {
    const assign = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    vi.stubGlobal('fetch', fetcher);
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('роль не выбрана (знакомство): «Аккаунт», в панели имя, почта и «Выйти», ролей нет', () => {
    render(<AccountMenu account={acc(null)} navigate={navigate} />);
    const btn = screen.getByRole('button', { name: /Аккаунт/ });
    expect(btn.textContent).toContain('ИП');
    fireEvent.click(btn);
    expect(screen.getByText('ivan@example.ru')).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Роль' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(logout).toHaveBeenCalled();
  });

  it('компания работодателя видна и из роли кандидата', () => {
    openMenu({ ...candidate, companyName: 'ООО Ромашка' });
    expect(screen.getByRole('button', { name: /Работодатель · ООО Ромашка/ })).toBeDefined();
  });
});
