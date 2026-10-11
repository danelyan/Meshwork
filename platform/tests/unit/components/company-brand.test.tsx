import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { CompanyLogo } from '@/components/landing/CompanyLogo';
import { CompanyProfile } from '@/components/employer/CompanyProfile';
import { filterTargets } from '@/components/candidate/CareerPage';
import type { TargetRec } from '@/server/recommend/types';

afterEach(cleanup);

it('renders a stored company as its brand without changing its record', () => {
  const company = Object.freeze({ name: 'Гранит Софт', description: 'Вымышленный разработчик корпоративных систем (демо)', industry: null, inn: null, contact: 'jobs@example.com' });
  render(<CompanyProfile company={company} />);
  expect(screen.getByRole('heading', { name: 'Ozon' })).toBeTruthy();
  expect(screen.queryByText(/Вымышленный/)).toBeNull();
  expect(document.querySelector('img')?.getAttribute('src')).toBe('/assets/companies/ozon.png');
  expect(company.name).toBe('Гранит Софт');
});

it('finds the original vacancy by its displayed brand without replacing vacancy data', () => {
  const vacancy: TargetRec = { vacancyId: 'original-vacancy', companyId: 'original-company', companyName: 'Северный Поток', title: 'Backend-разработчик платежей (Middle)', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 280000, covered: 1, total: 2, missing: [], reason: 'Покрытие навыков' };
  const result = filterTargets([vacancy], { query: 'Т-Банк', specialization: '', grade: '', salary: '' });
  expect(result).toEqual([vacancy]);
  expect(result[0]).toBe(vacancy);
});

it('keeps unknown companies visible with a letter fallback', () => {
  const { container } = render(<CompanyLogo company={{ name: 'Новая компания' }} />);
  expect(container.textContent).toBe('Н');
  expect(container.querySelector('img')).toBeNull();
});

it('keeps floating company cards monochrome until hover or keyboard focus', () => {
  const css = readFileSync('src/components/landing/HiringShowcase.module.css', 'utf8');
  expect(css.match(/\.company \{[^}]+\}/)?.[0]).toContain('filter: grayscale(1)');
  expect(css.match(/\.company:hover, \.company:focus-visible \{[^}]+\}/)?.[0]).toContain('filter: grayscale(0)');
  expect(css.match(/\.matched \{[^}]+\}/)?.[0]).not.toContain('filter:');
});
