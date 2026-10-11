import { describe, expect, it } from 'vitest';

import { buildCatalog, firstLine, type CompanyRow } from '@/server/companies/aggregate';

const v = (salaryFrom: number, salaryTo: number, specialization = 'backend') => ({
  id: `${salaryFrom}`, title: 't', specialization, grade: 'middle', salaryFrom, salaryTo, description: null,
});
const co = (id: string, name: string, vacancies: CompanyRow['vacancies'], description: string | null = null): CompanyRow =>
  ({ id, name, industry: 'Финтех', description, vacancies });

describe('buildCatalog', () => {
  it('отбрасывает компании без открытых вакансий', () => {
    expect(buildCatalog([co('a', 'А', [])])).toEqual([]);
  });

  it('считает число, вилку и уникальные направления', () => {
    const [card] = buildCatalog([co('a', 'А', [v(100, 200), v(150, 400, 'ai'), v(90, 180)])]);
    expect(card).toMatchObject({ vacancyCount: 3, salaryMin: 90, salaryMax: 400, specializations: ['backend', 'ai'] });
  });

  it('сортирует по числу вакансий, затем по имени', () => {
    const rows = [co('b', 'Бета', [v(1, 2)]), co('a', 'Альфа', [v(1, 2)]), co('c', 'Гамма', [v(1, 2), v(1, 2)])];
    expect(buildCatalog(rows).map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('берёт первую непустую строку описания', () => {
    expect(firstLine('\n  \nПервая\nВторая')).toBe('Первая');
    expect(firstLine(null)).toBeNull();
  });
});
