import { cleanup, render, screen } from '@testing-library/react';

import HomePage from '@/app/page';

// Проверка связки jsdom + React + Testing Library для лейна ui (docs Next.js: Vitest).
afterEach(cleanup);

it('главная рендерит заголовок', () => {
  render(<HomePage />);
  expect(screen.getByRole('heading', { level: 1, name: 'ФСП Карьера' })).toBeDefined();
});
