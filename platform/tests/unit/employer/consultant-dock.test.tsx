import { cleanup, render, screen, within } from '@testing-library/react';

import { DashboardFrame } from '@/components/shell/DashboardFrame';
import type { HeaderAccount } from '@/server/auth/role-plan';

const nav = vi.hoisted(() => ({ pathname: '/employer/search' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/components/candidate/CandidateSidebarSummary', () => ({ CandidateSidebarSummary: () => null }));
afterEach(cleanup);

const employer: HeaderAccount = { userName: 'Анна Кравец', userEmail: null, roles: { role: 'employer', other: 'candidate', otherExists: false, canCreateOther: true, companyName: 'Северный Поток' } };
const DOCK = 'Спросить консультанта про подборку';

// Аудит дизайна UI-005: карточка помощника была position: fixed и закрывала «Пригласить» и поля формы.
// Теперь она в потоке боковой колонки кабинета; вне колонки (и поверх содержимого) её нет.
describe('карточка помощника по подбору в кабинете работодателя', () => {
  it('стоит внутри боковой колонки, а не рядом с содержимым страницы', () => {
    nav.pathname = '/employer/search';
    render(<DashboardFrame account={employer}><button type="button">Пригласить</button></DashboardFrame>);
    const sidebar = screen.getByRole('complementary', { name: 'Ваш кабинет' });
    expect(within(sidebar).getByRole('link', { name: DOCK }).getAttribute('href')).toBe('/employer/assistant');
    expect(screen.getAllByRole('link', { name: DOCK })).toHaveLength(1);
    // не попадает в список разделов кабинета
    expect(within(screen.getByRole('navigation', { name: 'Разделы кабинета' })).queryByRole('link', { name: DOCK })).toBeNull();
  });

  it('без боковой колонки (bare) и у кандидата карточки нет', () => {
    nav.pathname = '/employer/search';
    const view = render(<DashboardFrame account={employer} bare><p>x</p></DashboardFrame>);
    expect(screen.queryByRole('link', { name: DOCK })).toBeNull();
    view.unmount();
    nav.pathname = '/career';
    render(<DashboardFrame account={{ ...employer, roles: { ...employer.roles!, role: 'candidate', other: 'employer', companyName: null } }}><p>x</p></DashboardFrame>);
    expect(screen.queryByRole('link', { name: DOCK })).toBeNull();
  });
});
