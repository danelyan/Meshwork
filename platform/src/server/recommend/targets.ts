import { hiddenVacancyIds } from '../admin/moderation/red-flags';
import { notBlockedVacancyWhere } from '../admin/accounts/state';
import { prisma } from '../db';

import { assertCandidate, loadCatalog, loadConfirmedIndex, parseNeeds } from './evidence';
import { computeCoverage, describeCoverage } from './matcher';
import type { TargetRec } from './types';

/**
 * Обратный прогон матчера по всем вакансиям платформы. Формулировки – «по
 * вакансиям на платформе»: рыночных цифр и вероятности приглашения нет.
 */
export async function recommendTargets(candidateId: string, limit: number): Promise<TargetRec[]> {
  await assertCandidate(candidateId);
  const [vacancies, catalog, index] = await Promise.all([
    // lane admin (E-08, фаза 2): скрытые модератором вакансии не рекомендуются.
    hiddenVacancyIds().then((hidden) => prisma.vacancy.findMany({ where: { archivedAt: null, ...notBlockedVacancyWhere(), ...(hidden.length ? { id: { notIn: hidden } } : {}) }, include: { company: true }, orderBy: { id: 'asc' } })),
    loadCatalog(),
    loadConfirmedIndex(candidateId),
  ]);
  const scored = vacancies
    .map((v) => ({ v, r: computeCoverage(parseNeeds(v.needs), catalog, index) }))
    .filter(({ r }) => r.score > 0);
  scored.sort((a, b) => b.r.score - a.r.score || b.r.covered - a.r.covered || a.v.id.localeCompare(b.v.id));
  return scored.slice(0, Math.max(0, limit)).map(({ v, r }) => ({
    vacancyId: v.id,
    companyId: v.companyId,
    companyName: v.company.name,
    title: v.title,
    specialization: v.specialization,
    grade: v.grade,
    salaryFrom: v.salaryFrom,
    salaryTo: v.salaryTo,
    covered: r.covered,
    total: r.total,
    missing: r.missing,
    reason: `По вакансиям на платформе: ${describeCoverage(r)}`,
  }));
}
