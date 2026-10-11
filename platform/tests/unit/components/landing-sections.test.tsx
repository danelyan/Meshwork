import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LandingSections } from '@/components/landing/LandingSections';

afterEach(cleanup);

it('lets visitors inspect evidence without treating the demo as their profile', () => {
  render(<LandingSections signedIn={false} />);
  const levels = screen.getByRole('group', { name: 'Уровни доказанности примера навыка' });
  const detail = document.getElementById('landing-proof-detail')!;
  expect(detail.textContent).toContain('код проекта объяснён на защите');
  fireEvent.click(within(levels).getByRole('button', { name: /Третья сторона/ }));
  expect(detail.textContent).toContain('Подтверждения от ФСП или ментора пока нет');
  expect(within(levels).getByRole('button', { name: /Третья сторона/ }).getAttribute('aria-pressed')).toBe('true');
  expect(within(levels).getByRole('button', { name: /Проверено платформой/ }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(within(levels).getByRole('button', { name: /Есть в проекте/ }));
  expect(detail.textContent).toContain('В репозитории API, тесты и обработка ошибок');
});

it('shows calls and projects as optional and keeps employer entry in the existing auth flow', () => {
  render(<LandingSections signedIn={false} />);
  const route = screen.getByRole('region', { name: 'Путь кандидата' });
  const optional = route.querySelectorAll('li[data-optional="true"]');
  expect([...optional].map(item => item.querySelector('h3')?.textContent)).toEqual(['Созвон', 'Проект']);
  expect(screen.getByRole('link', { name: /Я работодатель/ }).getAttribute('href')).toBe('/auth?next=%2Femployer%2Fassistant');
  expect(screen.getByText('Поможет оформить вилку и условия.')).toBeTruthy();
  expect(screen.queryByText('Ориентир по рынку для приглашения.')).toBeNull();
});

it('uses the guarded employer destination for signed-in visitors', () => {
  render(<LandingSections signedIn />);
  expect(screen.getByRole('link', { name: /Я работодатель/ }).getAttribute('href')).toBe('/employer/assistant');
});
