import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SavedVacancies } from '@/components/candidate/SavedVacancies';
import { ProjectFeed } from '@/components/project/ProjectFeed';
import type { CareerVacancy } from '@/server/recommend/career';
import type { FeedItem } from '@/server/project/service';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a> }));
afterEach(cleanup);
const vacancy = (id: string, name: string, covered: number): CareerVacancy => ({ vacancyId: id, companyId: id, companyName: name, title: `API ${name}`, specialization: 'backend', grade: 'middle', salaryFrom: 100000, salaryTo: 200000, covered, total: 5, reason: 'Требования вакансии', missing: [{ catalogId: 'sql', statement: 'SQL' }], description: null, teamDescription: null, stack: [], matched: [], projectTaskId: null });
it('saved map uses real coverage, changes selection and removes only selected vacancy', () => {
  const remove = vi.fn();
  render(<SavedVacancies vacancies={[vacancy('a', 'Альфа', 3), vacancy('b', 'Бета', 4)]} categories={[]} saving={false} error={null} onRemove={remove} />);
  const detail = screen.getByLabelText('Выбранная сохранённая вакансия');
  expect(within(detail).getByText('60%')).toBeDefined();
  fireEvent.click(within(screen.getByLabelText('Карта избранных вакансий')).getByRole('button', { name: /Бета/ }));
  expect(within(detail).getByText('80%')).toBeDefined();
  expect(within(detail).getByRole('link', { name: 'Смотреть вакансию ↗' }).getAttribute('href')).toBe('/career?vacancy=b');
  fireEvent.click(within(detail).getByRole('button', { name: 'Убрать из избранного: Бета' }));
  expect(remove).toHaveBeenCalledWith('b');
});
it('saved map clamps overcoverage and never divides by zero', () => {
  render(<SavedVacancies vacancies={[{ ...vacancy('a', 'Альфа', 9), total: 0 }]} categories={[]} saving={false} error={null} onRemove={vi.fn()} />);
  expect(within(screen.getByLabelText('Выбранная сохранённая вакансия')).getByText('0%')).toBeDefined();
});
it('project tabs filter actual taken state without inventing tasks', () => {
  const task = (id: string, taken: boolean): FeedItem => ({ id, title: id, domainStory: 'Задание', specialization: 'backend', specializationLabel: 'Backend', subcategoryId: null, subcategoryTitle: null, grade: 'junior', stack: [], timeBudgetMin: 120, deadlineDays: 3, invited: false, visibleTests: [], createdAt: '2026-10-11', spec: { title: id, domainStory: 'Задание', requirements: [], acceptance: [], notes: '', contractMd: '', source: 'fallback' }, my: { taken, active: taken, expiresAt: null, submissions: 0, last: null } });
  render(<ProjectFeed items={[task('Первое', true), task('Второе', false)]} limit={{ maxActive: 2, active: 1 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Мои · 1' }));
  expect(screen.getByRole('heading', { name: 'Первое' })).toBeDefined();
  expect(screen.queryByRole('heading', { name: 'Второе' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Доступно · 1' }));
  expect(screen.getByRole('heading', { name: 'Второе' })).toBeDefined();
  expect(screen.queryByRole('heading', { name: 'Первое' })).toBeNull();
});
