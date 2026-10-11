import 'server-only';

import { prisma } from '@/server/db';

import { buildCatalog, type CompanyCard, type CompanyDetail, type CompanyRow } from './aggregate';

export type { CompanyCard, CompanyDetail, CompanyVacancy } from './aggregate';

const SELECT = {
  id: true, name: true, industry: true, description: true,
  vacancies: {
    where: { archivedAt: null },
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, title: true, specialization: true, grade: true, salaryFrom: true, salaryTo: true, description: true },
  },
};

/** Компании с неархивными вакансиями. Контакт и ИНН не выбираются: инициатива у работодателя. */
export async function listCompanyCards(): Promise<CompanyCard[]> {
  const rows = await prisma.company.findMany({ where: { vacancies: { some: { archivedAt: null } } }, select: SELECT });
  return buildCatalog(rows as CompanyRow[]);
}

/** null — компании нет или у неё нет открытых вакансий. */
export async function getCompanyDetail(id: string): Promise<CompanyDetail | null> {
  const row = await prisma.company.findUnique({ where: { id }, select: SELECT });
  if (!row || !row.vacancies.length) return null;
  const [card] = buildCatalog([row as CompanyRow]);
  return { ...card, fullDescription: row.description, vacancies: (row as CompanyRow).vacancies };
}
