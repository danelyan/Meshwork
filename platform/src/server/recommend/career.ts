import type { Prisma } from '@prisma/client';

import { prisma } from '../db';
import type { CatalogEntry } from '../claims/types';
import { assertCandidate, loadCatalog, loadConfirmedIndex, parseNeeds, type EvidenceIndex } from './evidence';
import { categoryNeeds } from './gap-map';
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
  /**
   * Покрытие полной категории вакансии (`<spec>:<grade>`) — тот же список, что «Карта пробелов»
   * на /skills. `missing` = строки карты со «Сейчас: Нет». Вакансия может требовать меньше
   * категории: «6 из 6» по вакансии и пробелы по категории — не противоречие, а разные списки.
   * null — категории нет в каталоге (senior, ai, …).
   */
  category?: { id: string; label: string; covered: number; total: number; missing: { catalogId: string; statement: string }[] } | null;
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
      ...withCategory(v.specialization, v.grade, coverage, catalog, index),
      projectTaskId: v.projectTasks?.find((t) => t.visibility === 'open' && categories.some((c) => c.specialization === t.specialization && GRADE_INDEX[c.grade] >= GRADE_INDEX[t.grade]))?.id ?? null,
      description: v.description, teamDescription: v.teamDescription, stack: v.stack,
      matched: coverage.items.filter((item) => item.level !== null).map((item) => ({ catalogId: item.catalogId, statement: item.statement, level: item.level })),
    })),
  };
}

const SPEC_LABEL: Record<string, string> = { backend: 'Backend', frontend: 'Frontend' };
const GRADE_LABEL: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };
const MISSING_SHOWN = 3;

/**
 * Пояснение к совпадению: требования вакансии + сколько не хватает до полной категории.
 * Обе части считает один computeCoverage (creditFor), поэтому требование не бывает
 * «закрыто» в одной и «Нет» в другой.
 */
export function withCategory(
  spec: string, grade: string,
  coverage: ReturnType<typeof computeCoverage>,
  catalog: Map<string, CatalogEntry>, index: EvidenceIndex,
): { reason: string; category: NonNullable<CareerVacancy['category']> | null } {
  const vacancyText = `Требования вакансии: ${describeCoverage(coverage)}`;
  // categoryNeeds знает только backend|frontend × junior|middle (как /api/recommendations)
  if (!(spec in SPEC_LABEL) || (grade !== 'junior' && grade !== 'middle')) return { reason: vacancyText, category: null };
  const full = computeCoverage(categoryNeeds(catalog, `${spec}:${grade}`), catalog, index);
  if (full.total === 0) return { reason: vacancyText, category: null };
  const label = `${SPEC_LABEL[spec] ?? spec} · ${GRADE_LABEL[grade] ?? grade}`;
  const category = { id: `${spec}:${grade}`, label, covered: full.covered, total: full.total, missing: full.missing };
  if (full.missing.length === 0) return { reason: `${vacancyText}. Категория ${label} закрыта полностью`, category };
  const shown = full.missing.slice(0, MISSING_SHOWN).map((m) => m.statement).join('; ');
  const rest = full.missing.length > MISSING_SHOWN ? ` и ещё ${full.missing.length - MISSING_SHOWN}` : '';
  return { reason: `${vacancyText}. До полной категории ${label} (${full.covered} из ${full.total}) не хватает: ${shown}${rest}`, category };
}
