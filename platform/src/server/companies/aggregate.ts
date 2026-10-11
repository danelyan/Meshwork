export interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  description: string | null;
  vacancies: CompanyVacancy[];
}

export interface CompanyVacancy {
  id: string;
  title: string;
  specialization: string;
  grade: string;
  salaryFrom: number;
  salaryTo: number;
  description: string | null;
}

export interface CompanyCard {
  id: string;
  name: string;
  industry: string | null;
  /** Первая непустая строка описания. */
  summary: string | null;
  vacancyCount: number;
  salaryMin: number;
  salaryMax: number;
  specializations: string[];
  /** Первые вакансии (свежие сверху) для списка компаний. */
  preview: { id: string; title: string; salaryFrom: number; salaryTo: number }[];
}

export interface CompanyDetail extends CompanyCard {
  fullDescription: string | null;
  vacancies: CompanyVacancy[];
}

export function firstLine(text: string | null | undefined): string | null {
  return text?.split('\n').map((l) => l.trim()).find(Boolean) ?? null;
}

/** Компании без открытых вакансий отбрасываются; порядок: больше вакансий, затем по имени. */
export function buildCatalog(rows: CompanyRow[]): CompanyCard[] {
  return rows
    .filter((c) => c.vacancies.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      summary: firstLine(c.description),
      vacancyCount: c.vacancies.length,
      salaryMin: Math.min(...c.vacancies.map((v) => v.salaryFrom)),
      salaryMax: Math.max(...c.vacancies.map((v) => v.salaryTo)),
      specializations: [...new Set(c.vacancies.map((v) => v.specialization))],
      preview: c.vacancies.slice(0, 3).map((v) => ({ id: v.id, title: v.title, salaryFrom: v.salaryFrom, salaryTo: v.salaryTo })),
    }))
    .sort((a, b) => b.vacancyCount - a.vacancyCount || a.name.localeCompare(b.name, 'ru'));
}
