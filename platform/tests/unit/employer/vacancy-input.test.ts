import { describe, expect, it } from 'vitest';
import { VacancyInput } from '@/server/employer/schemas';

const base = { title: 'Backend-разработчик', specialization: 'backend', grade: 'junior', subcategoryId: 'backend.highload', needs: [{ catalogId: 'be.lang-core', weight: 2 }] };

describe('VacancyInput: вилка (R-D-01)', () => {
  it('нулевая вилка не проходит — принятый отклик скопировал бы её в приглашение', () => {
    expect(VacancyInput.safeParse({ ...base, salaryFrom: 0, salaryTo: 0 }).success).toBe(false);
    expect(VacancyInput.safeParse({ ...base, salaryFrom: 0, salaryTo: 150000 }).success).toBe(false);
  });
  it('положительная вилка проходит', () => {
    expect(VacancyInput.safeParse({ ...base, salaryFrom: 100000, salaryTo: 150000 }).success).toBe(true);
  });
});
