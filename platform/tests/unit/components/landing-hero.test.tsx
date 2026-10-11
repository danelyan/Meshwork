import { cleanup, render, screen } from '@testing-library/react';
import { Hero } from '@/components/landing/Hero';

vi.mock('@/components/landing/HeroGraph', () => ({ HeroGraph: () => <div aria-label="Карта компаний" /> }));
vi.mock('@/components/landing/Start', () => ({ Start: ({ signedIn }: { signedIn: boolean }) => <a href={signedIn ? '/consultant' : '/auth'}>{signedIn ? 'В кабинет' : 'Приступим'}</a> }));
afterEach(cleanup);

it('shows the v2 slogan, real entry and explicitly simulated FSP registry', () => {
  render(<Hero signedIn={false} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Не ищи работу.Пусть найдут тебя.');
  expect(screen.getByRole('link', { name: 'Приступим' }).getAttribute('href')).toBe('/auth');
  expect(screen.getByRole('link', { name: 'ФСП ID и достижения' }).getAttribute('href')).toBe('https://fsp-russia.ru/');
  expect(screen.getByText(/демореестр/)).toBeDefined();
  expect(screen.queryByRole('link', { name: /Для жюри/ })).toBeNull();
});

it('keeps the cabinet entry for signed-in users and gates the jury route', () => {
  render(<Hero signedIn demoEnabled />);
  expect(screen.getByRole('link', { name: 'В кабинет' }).getAttribute('href')).toBe('/consultant');
  expect(screen.getByRole('link', { name: /Для жюри/ }).getAttribute('href')).toBe('/demo');
  expect(screen.queryByRole('link', { name: 'Уже есть аккаунт? Войти' })).toBeNull();
});
