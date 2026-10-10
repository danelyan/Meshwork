import { cleanup, render, screen, within } from '@testing-library/react';

import { ShellFrame, useBareShell } from '@/components/shell/ShellFrame';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { SiteHeader } from '@/components/shell/SiteHeader';
import shellStyles from '@/components/shell/shell.module.css';
import type { SessionPrincipal } from '@/server/session';

const nav = vi.hoisted(() => ({ pathname: '/profile' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
const page = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('@/server/auth/page', () => ({ getPageSession: async () => page.session }));
vi.mock('@/components/candidate/CandidateSidebarSummary', () => ({ CandidateSidebarSummary: () => null }));
vi.mock('@/lib/api', () => ({ demoLogout: vi.fn(), getMe: () => Promise.resolve({ onboarded: true }), switchRoleApi: vi.fn() }));
// Меню роли (ADR 0004) читает БД — в тестах шапки подставляем готовое.
const menu = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/server/auth/role-switch', () => ({ headerAccountFor: async () => menu.value }));

const principal = (role: SessionPrincipal['role']): SessionPrincipal => ({ userId: 'u1', role, candidateId: null, employerProfileId: null });

async function renderHeader(session: SessionPrincipal | null, pathname: string, account: unknown = null) {
  page.session = session;
  menu.value = account;
  nav.pathname = pathname;
  render(await SiteHeader());
  return within(screen.getByRole('banner'));
}

afterEach(cleanup);

describe('SiteHeader', () => {
  it('гость на главной: якоря, «Войти» → /auth, без даты выпуска и «Выйти»', async () => {
    const h = await renderHeader(null, '/');
    expect(h.getByRole('link', { name: 'Компании' }).getAttribute('href')).toBe('#companies');
    expect(h.getByRole('link', { name: 'Почему мы' }).getAttribute('href')).toBe('#why');
    expect(h.queryByText('№ 01 · осень 2026')).toBeNull();
    expect(h.getByRole('link', { name: 'Войти' }).getAttribute('href')).toBe('/auth');
    expect(h.queryByRole('button', { name: 'Выйти' })).toBeNull();
  });

  it('гость не на главной: только бренд и «Войти»', async () => {
    const h = await renderHeader(null, '/auth');
    expect(h.queryByRole('link', { name: 'Компании' })).toBeNull();
    expect(h.queryByText('№ 01 · осень 2026')).toBeNull();
    expect(h.getByRole('link', { name: 'ФСП Карьера, на главную' }).getAttribute('href')).toBe('/');
    expect(h.getByRole('link', { name: 'Войти' })).toBeDefined();
  });

  it('кандидат: Консультант / Профиль / Тест / Приглашения, активная — по пути, гость-кнопки нет', async () => {
    const h = await renderHeader(principal('candidate'), '/profile');
    const links = h.getAllByRole('link').filter((a) => a.getAttribute('href') !== '/');
    expect(links.map((a) => a.textContent)).toEqual(['Консультант', 'Профиль', 'Тест', 'Проекты', 'Приглашения']);
    expect(h.getByRole('link', { name: 'Профиль' }).getAttribute('aria-current')).toBe('page');
    expect(h.getByRole('link', { name: 'Тест' }).getAttribute('aria-current')).toBeNull();
    expect(h.queryByRole('link', { name: 'Войти' })).toBeNull();
  });

  it('работодатель: свои ссылки; «Потребности» активна только на /employer', async () => {
    let h = await renderHeader(principal('employer'), '/employer');
    expect(h.getAllByRole('link').filter((a) => a.getAttribute('href') !== '/').map((a) => a.textContent)).toEqual(['Помощник', 'Потребности', 'Поиск по базе', 'Приглашения', 'Звонки']);
    expect(h.getByRole('link', { name: 'Потребности' }).getAttribute('aria-current')).toBe('page');
    cleanup();
    h = await renderHeader(principal('employer'), '/employer/search');
    expect(h.getByRole('link', { name: 'Потребности' }).getAttribute('aria-current')).toBeNull();
    expect(h.getByRole('link', { name: 'Поиск по базе' }).getAttribute('aria-current')).toBe('page');
  });

  it('кнопка аккаунта: инициалы, активная роль, меню закрыто (ADR 0004)', async () => {
    const h = await renderHeader(principal('employer'), '/employer', {
      userName: 'Иван Петров',
      userEmail: 'i@p.ru',
      roles: { role: 'employer', companyName: 'ООО Ромашка', other: 'candidate', otherExists: true, canCreateOther: false },
    });
    const btn = h.getByRole('button', { name: /Аккаунт, активная роль: Работодатель/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toContain('ООО Ромашка');
    expect(h.queryByRole('button', { name: 'Выйти' })).toBeNull();
  });

  it('аккаунт без роли (знакомство): без ссылок роли, кнопка «Аккаунт» вместо «Выйти» на виду', async () => {
    const h = await renderHeader(principal('pending'), '/consultant', { userName: 'Иван Петров', userEmail: 'i@p.ru', roles: null });
    expect(h.queryByRole('navigation')).toBeNull();
    expect(h.getByRole('button', { name: /Аккаунт/ }).getAttribute('aria-expanded')).toBe('false');
    expect(h.queryByRole('button', { name: 'Выйти' })).toBeNull();
  });

  it('иконка темы — только на /consultant', async () => {
    const account = { userName: 'Иван Петров', userEmail: 'i@p.ru', roles: null };
    let h = await renderHeader(principal('pending'), '/consultant', account);
    expect(h.getByRole('button', { name: 'Тёмная тема' })).toBeDefined();
    cleanup();
    h = await renderHeader(principal('pending'), '/profile', account);
    expect(h.queryByRole('button', { name: 'Тёмная тема' })).toBeNull();
  });

  it('сессия без учётки в БД (старая демо-кука): просто «Выйти»', async () => {
    const h = await renderHeader(principal('candidate'), '/consultant', null);
    expect(h.getByRole('button', { name: 'Выйти' })).toBeDefined();
  });
});

describe('SiteFooter', () => {
  it('содержимое главной, «Согласие» и «ФСП»; «Демо для жюри» только при DEMO_LOGIN', () => {
    render(<SiteFooter />);
    const f = within(screen.getByRole('contentinfo'));
    expect(f.getByText(/Федерация спортивного программирования/)).toBeDefined();
    expect(f.getByRole('link', { name: 'Согласие' }).getAttribute('href')).toBe('/consent');
    expect(f.getByRole('link', { name: 'ФСП' }).getAttribute('href')).toBe('https://fsp-russia.ru/');
    expect(f.queryByRole('link', { name: 'Демо для жюри' })).toBeNull();
    cleanup();
    render(<SiteFooter demo />);
    expect(screen.getByRole('link', { name: 'Демо для жюри' }).getAttribute('href')).toBe('/demo');
  });
});

describe('ShellFrame', () => {
  const frame = (child = <main id="main">страница</main>) => (
    <ShellFrame header={<header>шапка</header>} footer={<footer>подвал</footer>}>
      {child}
    </ShellFrame>
  );

  it('masks the page grid only for the consultant and restores it on navigation', () => {
    nav.pathname = '/consultant';
    const { container, rerender } = render(frame());
    expect(container.firstElementChild!.classList.contains(shellStyles.consultant!)).toBe(true);
    expect(screen.getByText('шапка')).toBeDefined();
    nav.pathname = '/';
    rerender(frame());
    expect(container.firstElementChild!.classList.contains(shellStyles.consultant!)).toBe(false);
  });

  it('обычная страница: шапка, содержимое, подвал и ссылка «К содержимому»', () => {
    nav.pathname = '/profile';
    render(frame());
    expect(screen.getByText('шапка')).toBeDefined();
    expect(screen.getByText('подвал')).toBeDefined();
    expect(screen.getByRole('link', { name: 'К содержимому' }).getAttribute('href')).toBe('#main');
  });

  it('/onboarding: ни шапки, ни подвала (у чата своя полоса)', () => {
    nav.pathname = '/onboarding';
    render(frame());
    expect(screen.queryByText('шапка')).toBeNull();
    expect(screen.queryByText('подвал')).toBeNull();
    expect(screen.getByText('страница')).toBeDefined();
  });

  it('страница прячет оболочку через useBareShell (тест в процессе) и возвращает при уходе', () => {
    nav.pathname = '/test';
    function Attempt({ active }: { active: boolean }) {
      useBareShell(active);
      return <main id="main">тест</main>;
    }
    const { rerender } = render(frame(<Attempt active />));
    expect(screen.queryByText('шапка')).toBeNull();
    rerender(frame(<Attempt active={false} />));
    expect(screen.getByText('шапка')).toBeDefined();
  });
});
