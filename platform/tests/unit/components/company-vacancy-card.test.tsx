import { cleanup, render, screen } from '@testing-library/react';

import { CompanyVacancyCard } from '@/components/candidate/CompanyVacancyCard';
import type { CareerVacancy } from '@/server/recommend/career';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/components/candidate/ApplyPanel', () => ({ ApplyPanel: ({ vacancyId }: { vacancyId: string }) => <div data-testid="apply">{vacancyId}</div> }));

const vacancy: CareerVacancy = {
  vacancyId: 'v1', companyId: 'c1', companyName: 'Альфа', title: 'Разработчик API', specialization: 'backend', grade: 'middle',
  salaryFrom: 150000, salaryTo: 200000, covered: 1, total: 2, reason: '', description: 'Строим API', teamDescription: 'Команда из пяти',
  stack: ['Go', 'Postgres'], matched: [{ catalogId: 'a', statement: 'REST', level: null }], missing: [{ catalogId: 'b', statement: 'Оптимизация SQL' }], projectTaskId: null,
};

afterEach(cleanup);

describe('CompanyVacancyCard', () => {
  it('показывает описание, команду, стек и соответствие', () => {
    render(<CompanyVacancyCard vacancy={vacancy} categories={[{ specialization: 'backend', grade: 'middle' }]} />);
    expect(screen.getByText('Строим API')).toBeTruthy();
    expect(screen.getByText('Команда из пяти')).toBeTruthy();
    expect(screen.getByText('Postgres')).toBeTruthy();
    expect(screen.getByText('Закрываешь 1 из 2 требований')).toBeTruthy();
    expect(screen.getByText(/Оптимизация SQL/)).toBeTruthy();
    expect(screen.getByTestId('apply').textContent).toBe('v1');
    expect(screen.getByRole('link', { name: 'Открыть на карте соответствия' }).getAttribute('href')).toBe('/career?vacancy=v1');
    expect(screen.getByRole('link', { name: /Что подтянуть/ }).getAttribute('href')).toBe('/consultant');
  });

  it('без категории ведёт на тест', () => {
    render(<CompanyVacancyCard vacancy={vacancy} categories={[]} />);
    expect(screen.getByRole('link', { name: 'Пройти тест' }).getAttribute('href')).toBe('/test');
  });
});
