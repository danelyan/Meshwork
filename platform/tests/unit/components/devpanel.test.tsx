import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DevPanel } from '@/components/devtools/DevPanel';
import { DevPanelGate } from '@/components/devtools/DevPanelGate';

const nav = vi.hoisted(() => ({ pathname: '/consultant' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
const guard = vi.hoisted(() => ({ on: true }));
vi.mock('@/server/devtools/guard', () => ({ isDevHost: async () => guard.on }));

const assign = vi.fn();
const calls: { url: string; body?: string }[] = [];
let me: unknown;

beforeEach(() => {
  calls.length = 0;
  assign.mockReset();
  nav.pathname = '/consultant';
  me = { id: 'user-abcdefghij-123', name: 'Глеб', role: 'candidate', isDemo: true, onboarded: true };
  Object.defineProperty(window, 'location', { value: { assign }, writable: true, configurable: true });
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url === '/api/auth/me') return Response.json({ user: me });
      if (url === '/api/dev/login-as' && !init) return Response.json({ candidates: [{ id: 'c1', name: 'Демо К' }], employers: [{ id: 'e1', name: 'Демо Р' }] });
      return Response.json({ ok: true, next: '/somewhere', deleted: 2 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openPanel = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Дебаг-панель' }));
  await screen.findByText('Глеб');
};

describe('DevPanel', () => {
  it('закрыта по умолчанию; по клику показывает кто я и путь; Esc закрывает', async () => {
    render(<DevPanel />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await openPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/кандидат · демо/)).toBeTruthy();
    expect(screen.getByText('/consultant')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ctrl+Shift+D переключает, состояние запоминается в localStorage', async () => {
    const { unmount } = render(<DevPanel />);
    fireEvent.keyDown(document, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(window.localStorage.getItem('fsp:devpanel:open')).toBe('1');
    unmount();
    render(<DevPanel />);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('клик вне закрывает', async () => {
    render(<DevPanel />);
    await openPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Начать диалог заново» на /consultant → new-conversation и переход', async () => {
    render(<DevPanel />);
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Начать диалог заново' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/somewhere'));
    expect(calls.some((c) => c.url === '/api/dev/new-conversation')).toBe(true);
  });

  it('на /onboarding то же действие очищает онбординг; галка уходит как alsoProfile', async () => {
    nav.pathname = '/onboarding';
    render(<DevPanel />);
    await openPanel();
    fireEvent.click(screen.getByLabelText('и ответы профиля'));
    fireEvent.click(screen.getByRole('button', { name: 'Начать диалог заново' }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const c = calls.find((x) => x.url === '/api/dev/reset-onboarding')!;
    expect(JSON.parse(c.body!)).toEqual({ alsoProfile: true });
  });

  it('«Очистить аккаунт» требует подтверждения; «Отмена» ничего не шлёт', async () => {
    render(<DevPanel />);
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить аккаунт…' }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/npm run db:seed/);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(calls.some((c) => c.url === '/api/dev/delete-account')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Очистить аккаунт…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/somewhere'));
    expect(calls.some((c) => c.url === '/api/dev/delete-account')).toBe(true);
  });

  it('«Войти как…» шлёт выбранный аккаунт', async () => {
    render(<DevPanel />);
    await openPanel();
    const select = await screen.findByLabelText('Войти как');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'e:e1' } });
    });
    await waitFor(() => expect(calls.find((c) => c.url === '/api/dev/login-as' && c.body)).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url === '/api/dev/login-as' && c.body)!.body!)).toEqual({ employerUserId: 'e1' });
  });

  it('ошибка сервера → тост с ошибкой, перехода нет', async () => {
    render(<DevPanel />);
    await openPanel();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Не получилось' } }, { status: 409 })));
    fireEvent.click(screen.getByRole('button', { name: 'Начать диалог заново' }));
    expect((await screen.findByRole('status')).textContent).toBe('Не получилось');
    expect(assign).not.toHaveBeenCalled();
  });

  it('«Сбросить попытки теста» доступна только кандидату', async () => {
    me = { id: 'u', name: 'Глеб', role: 'employer', isDemo: true, onboarded: true };
    render(<DevPanel />);
    await openPanel();
    expect((screen.getByRole('button', { name: 'Сбросить попытки теста' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('DevPanelGate', () => {
  it('не localhost → ничего не рендерит', async () => {
    guard.on = false;
    expect(await DevPanelGate()).toBeNull();
  });
  it('localhost → панель', async () => {
    guard.on = true;
    expect(await DevPanelGate()).not.toBeNull();
  });
});
