// Потребности компании (R-E-02). Хранятся в Vacancy: онбординг работодателя пишет
// туда же первую потребность; этот модуль существующие поля не переопределяет.
import { loadCatalog, parseNeeds, type Need } from '../recommend/evidence';
import { prisma } from '../db';
import { errors } from '../errors';
import type { Grade, Specialization } from '../types';

import type { VacancyInput } from './schemas';

export interface VacancyView {
  id: string;
  title: string;
  specialization: Specialization;
  grade: Grade;
  salaryFrom: number;
  salaryTo: number;
  teamDescription: string | null;
  description: string | null;
  stack: string[];
  needs: Need[];
  archived: boolean;
  createdAt: string;
  invitations: number;
}

const select = {
  id: true,
  title: true,
  specialization: true,
  grade: true,
  salaryFrom: true,
  salaryTo: true,
  teamDescription: true,
  description: true,
  stack: true,
  needs: true,
  archivedAt: true,
  createdAt: true,
  _count: { select: { invitations: true } },
} as const;

type Row = {
  id: string;
  title: string;
  specialization: Specialization;
  grade: Grade;
  salaryFrom: number;
  salaryTo: number;
  teamDescription: string | null;
  description: string | null;
  stack: string[];
  needs: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  _count: { invitations: number };
};

function toView(v: Row): VacancyView {
  return {
    id: v.id,
    title: v.title,
    specialization: v.specialization,
    grade: v.grade,
    salaryFrom: v.salaryFrom,
    salaryTo: v.salaryTo,
    teamDescription: v.teamDescription,
    description: v.description,
    stack: v.stack,
    needs: parseNeeds(v.needs),
    archived: v.archivedAt !== null,
    createdAt: v.createdAt.toISOString(),
    invitations: v._count.invitations,
  };
}

export async function listVacancies(companyId: string): Promise<VacancyView[]> {
  const rows = await prisma.vacancy.findMany({ where: { companyId }, select, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'asc' }] });
  return rows.map(toView);
}

/** Своя потребность или 404 (чужая неотличима от несуществующей). */
export async function getVacancy(companyId: string, id: string): Promise<VacancyView> {
  const v = await prisma.vacancy.findFirst({ where: { id, companyId }, select });
  if (!v) throw errors.notFound('Потребность не найдена');
  return toView(v);
}

/** Требования — только из каталога и только своей специализации или общие. */
async function checkNeeds(input: VacancyInput): Promise<Need[]> {
  const catalog = await loadCatalog();
  const bad = input.needs.filter((n) => {
    const e = catalog.get(n.catalogId);
    return !e || (e.specialization !== 'common' && e.specialization !== input.specialization);
  });
  if (bad.length) throw errors.badRequest('Требования не из каталога или другой специализации', bad.map((b) => b.catalogId));
  const seen = new Set<string>();
  return input.needs.filter((n) => (seen.has(n.catalogId) ? false : (seen.add(n.catalogId), true)));
}

function data(input: VacancyInput, needs: Need[]) {
  return {
    title: input.title,
    specialization: input.specialization,
    grade: input.grade,
    salaryFrom: input.salaryFrom,
    salaryTo: input.salaryTo,
    teamDescription: input.teamDescription,
    description: input.description,
    stack: input.stack,
    needs: needs.map((n) => ({ catalogId: n.catalogId, weight: n.weight })),
  };
}

export async function createVacancy(companyId: string, input: VacancyInput): Promise<VacancyView> {
  const needs = await checkNeeds(input);
  const v = await prisma.vacancy.create({ data: { companyId, ...data(input, needs) }, select });
  return toView(v);
}

export async function updateVacancy(companyId: string, id: string, input: VacancyInput): Promise<VacancyView> {
  await getVacancy(companyId, id);
  const needs = await checkNeeds(input);
  const v = await prisma.vacancy.update({ where: { id }, data: data(input, needs), select });
  return toView(v);
}

export async function setVacancyArchived(companyId: string, id: string, archived: boolean): Promise<VacancyView> {
  await getVacancy(companyId, id);
  const v = await prisma.vacancy.update({ where: { id }, data: { archivedAt: archived ? new Date() : null }, select });
  return toView(v);
}
