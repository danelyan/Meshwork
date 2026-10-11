import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AssistantDrawer, pageContext } from '@/components/employer/AssistantDrawer';

let pathname = '/employer/needs';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('next/image', () => ({ default: () => null }));
const chatProps = vi.fn();
vi.mock('@/components/employer/AssistantChat', () => ({
  AssistantChat: (p: object) => {
    chatProps(p);
    return <textarea aria-label="Сообщение" />;
  },
}));

beforeEach(() => {
  pathname = '/employer/needs';
  sessionStorage.clear();
  chatProps.mockClear();
});
afterEach(cleanup);

const openIt = () => fireEvent.click(screen.getByRole('button', { name: /Спросить помощницу/ }));

describe('AssistantDrawer', () => {
  it('закрыта по умолчанию, открывается кнопкой и закрывается крестиком', () => {
    render(<AssistantDrawer />);
    expect(screen.queryByRole('dialog')).toBeNull();
    openIt();
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: /Кира/ })).toBeTruthy();
    expect(sessionStorage.getItem('employer-assistant-drawer')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть помощницу' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sessionStorage.getItem('employer-assistant-drawer')).toBe('0');
  });

  it('Esc и клик по подложке закрывают, фокус возвращается на кнопку', () => {
    render(<AssistantDrawer />);
    openIt();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть помощницу' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Спросить помощницу/ }));
    openIt();
    fireEvent.click(screen.getByTestId('assistant-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('вспоминает открытое состояние из sessionStorage', () => {
    sessionStorage.setItem('employer-assistant-drawer', '1');
    render(<AssistantDrawer />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('вне вакансии чат получает общие быстрые запросы и page без vacancyId', () => {
    render(<AssistantDrawer />);
    openIt();
    expect(chatProps).toHaveBeenLastCalledWith(expect.objectContaining({ page: { path: pathname, vacancyId: null }, quickPrompts: ['Что у меня в подборке', 'Поищи по базе', 'Дополни профиль компании'] }));
  });

  it('на странице вакансии чипы про вакансию и page передаётся в чат', () => {
    pathname = '/employer/needs/n%201/edit';
    render(<AssistantDrawer />);
    openIt();
    expect(chatProps).toHaveBeenLastCalledWith(expect.objectContaining({ page: { path: pathname, vacancyId: 'n 1' }, quickPrompts: ['Подбери под эту вакансию', 'Кто в базе под неё', 'Сделай проектное задание к ней'] }));
  });

  it('ссылка на весь экран ведёт в /employer/assistant', () => {
    render(<AssistantDrawer />);
    openIt();
    expect(screen.getByRole('link', { name: /Открыть на весь экран/ }).getAttribute('href')).toBe('/employer/assistant');
  });

  it('pageContext: /needs/new — без vacancyId', () => {
    expect(pageContext('/employer/needs/new').vacancyId).toBeNull();
  });
});
