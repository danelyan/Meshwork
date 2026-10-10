import { cleanup, render, screen } from '@testing-library/react';

import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import EmployerTermsPage from '@/app/employer-terms/page';
import AiPage from '@/app/ai/page';

afterEach(cleanup);

const PAGES: Array<[string, () => React.ReactElement, RegExp]> = [
  ['/privacy', PrivacyPage, /Политика обработки персональных данных/],
  ['/terms', TermsPage, /Пользовательское соглашение/],
  ['/employer-terms', EmployerTermsPage, /Условия для работодателя/],
  ['/ai', AiPage, /Как работает ИИ/],
];

describe('правовые страницы', () => {
  it.each(PAGES)('%s: заголовок, плашка черновика, заглушка оператора, оглавление', (_path, Page, title) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeDefined();
    expect(screen.getByRole('note').textContent).toMatch(/Черновик для демонстрации на хакатоне, не юридический текст/);
    expect(document.body.textContent).toMatch(/\[адрес для запросов\]/);
    expect(document.body.textContent).toMatch(/\[Оператор: наименование, ИНН, адрес\]/);
    expect(screen.getByRole('navigation', { name: 'Оглавление' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Правовые документы' })).toBeDefined();
  });
});
