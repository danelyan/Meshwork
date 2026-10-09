/** Данные главной - витрина (showcase.ts), не данные сервиса. */
export interface LandingCompany {
  id: string;
  name: string;
  /** «Backend, Frontend · Junior, Middle» из вакансий компании. */
  focus: string;
  description: string | null;
  vacancies: number;
  /** Максимум salaryTo по вакансиям, ₽. */
  maxSalary: number;
}

export interface LandingStats {
  companies: number;
  vacancies: number;
  /** Кандидаты хотя бы с одной подтверждённой тестом категорией. */
  categorized: number;
  /** Максимальная верхняя граница вилки среди вакансий, ₽ (0 — вакансий нет). */
  maxSalary: number;
  /** Доля приглашений с ответом кандидата за сутки, %. */
  responseRate: number;
}

export interface LandingData {
  companies: LandingCompany[];
  stats: LandingStats;
}
