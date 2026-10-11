import type { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { assertCandidate, loadCatalog, loadConfirmedIndex, parseNeeds } from './evidence';
import { computeCoverage, describeCoverage } from './matcher';
import type { Grade } from '../types';
import type { TargetRec } from './types';
import { GRADE_INDEX } from './weights';

export const CAREER_PAGE_LIMIT = 200;
export interface CareerVacancy extends TargetRec {
  description: string | null;
  teamDescription: string | null;
  stack: string[];
  matched: { catalogId: string; statement: string; level: string | null }[];
  /** Открытое задание вакансии, которое кандидат может взять сейчас (направление и грейд по его категории), иначе null. */
  projectTaskId: string | null;
}
export interface CareerVacanciesView { targets: CareerVacancy[]; truncated: boolean; categories: { specialization: string; grade: Grade }[] }

/** Active catalogue, not only the recommendation top five. Saved rows survive changes of profile/score. */
export async function careerVacancies(candidateId: string, savedIds?: string[]): Promise<CareerVacanciesView> {
  await assertCandidate(candidateId);
  const where: Prisma.VacancyWhereInput = { archivedAt: null, ...(savedIds ? { id: { in: savedIds } } : {}) };
  const [vacancies, catalog, index, categories] = await Promise.all([
    prisma.vacancy.findMany({ where, include: { company: { select: { name: true } }, projectTasks: { select: { id: true, visibility: true, specialization: true, grade: true } } }, orderBy: { id: 'asc' }, take: CAREER_PAGE_LIMIT + 1 }),
    loadCatalog(),
    loadConfirmedIndex(candidateId),
    prisma.candidateCategory.findMany({ where: { candidateId }, select: { specialization: true, grade: true } }),
  ]);
  const scored = vacancies.slice(0, CAREER_PAGE_LIMIT).map((v) => ({ v, coverage: computeCoverage(parseNeeds(v.needs), catalog, index) }));
  scored.sort((a, b) => b.coverage.score - a.coverage.score || b.coverage.covered - a.coverage.covered || a.v.id.localeCompare(b.v.id));
  return {
    truncated: vacancies.length > CAREER_PAGE_LIMIT,
    categories,
    targets: scored.map(({ v, coverage }) => ({
      vacancyId: v.id, companyId: v.companyId, companyName: v.company.name, title: v.title,
      specialization: v.specialization, grade: v.grade, salaryFrom: v.salaryFrom, salaryTo: v.salaryTo,
      covered: coverage.covered, total: coverage.total, missing: coverage.missing,
      reason: `По требованиям вакансии: ${describeCoverage(coverage)}`,
      projectTaskId: v.projectTasks?.find((t) => t.visibility === 'open' && categories.some((c) => c.specialization === t.specialization && GRADE_INDEX[c.grade] >= GRADE_INDEX[t.grade]))?.id ?? null,
      description: v.description, teamDescription: v.teamDescription, stack: v.stack,
      matched: coverage.items.filter((item) => item.level !== null).map((item) => ({ catalogId: item.catalogId, statement: item.statement, level: item.level })),
    })),
  };
}
