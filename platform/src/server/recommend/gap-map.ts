import type { CatalogEntry } from '../claims/types';
import { errors } from '../errors';
import { prisma } from '../db';
import type { Grade } from '../types';

import {
  assertCandidate,
  creditFor,
  loadCatalog,
  loadConfirmedIndex,
  loadProvenGrade,
  parseNeeds,
  type EvidenceIndex,
  type Need,
} from './evidence';
import type { Gap, GapTarget } from './types';
import { GRADE_INDEX, gradeWeight, REACH_PENALTY } from './weights';

/**
 * Посильность [предложение]: грейд, с которого ожидается утверждение, не выше
 * доказанного + 1. Доказанного нет (теста не было) — считаем «ниже junior» (-1).
 */
export function reachFactor(entry: CatalogEntry, provenGrade: Grade | null): number {
  const proven = provenGrade ? GRADE_INDEX[provenGrade] : -1;
  const expected = Math.min(...entry.grades.map((g) => GRADE_INDEX[g]));
  if (!Number.isFinite(expected)) return 1;
  return expected - proven <= 1 ? 1 : REACH_PENALTY;
}

/** Чистое ядро: потребности цели + доказательства → пробелы по убыванию приоритета. */
export function computeGaps(
  needs: Need[],
  catalog: Map<string, CatalogEntry>,
  index: EvidenceIndex,
  provenGrade: Grade | null,
): Gap[] {
  const seen = new Set<string>();
  const gaps: Gap[] = [];
  for (const need of needs) {
    const entry = catalog.get(need.catalogId);
    if (!entry || seen.has(need.catalogId)) continue; // несуществующий ID не выдумываем
    seen.add(need.catalogId);
    const current = index.get(need.catalogId) ?? null;
    if (current === 'platform') continue; // не пробел
    const { credit } = creditFor(need.catalogId, index, catalog); // смежность — половинный зачёт
    const priority = need.weight * (1 - credit) * reachFactor(entry, provenGrade);
    gaps.push({
      id: entry.id,
      catalogId: entry.id,
      statement: entry.statement,
      weight: need.weight as 1 | 2 | 3,
      currentLevel: current,
      priority: Math.round(priority * 1e6) / 1e6,
      suggestedProof: entry.proof,
    });
  }
  return gaps.sort((a, b) => b.priority - a.priority || a.catalogId.localeCompare(b.catalogId));
}

/** Потребности категории `<spec>:<grade>`: утверждения специализации и общие этого грейда. */
export function categoryNeeds(catalog: Map<string, CatalogEntry>, id: string): Need[] {
  const [spec, grade] = id.split(':');
  if ((spec !== 'backend' && spec !== 'frontend') || (grade !== 'junior' && grade !== 'middle')) {
    throw errors.badRequest('Категория задаётся как backend:junior … frontend:middle');
  }
  const out: Need[] = [];
  for (const e of [...catalog.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (e.specialization !== spec && e.specialization !== 'common') continue;
    const w = gradeWeight(e, spec, grade);
    if (w !== null && w > 0) out.push({ catalogId: e.id, weight: w });
  }
  return out;
}

export async function gapMap(candidateId: string, target: GapTarget): Promise<Gap[]> {
  await assertCandidate(candidateId);
  const catalog = await loadCatalog();
  let needs: Need[];
  if (target.kind === 'vacancy') {
    const v = await prisma.vacancy.findUnique({ where: { id: target.id } });
    if (!v) throw errors.notFound('Вакансия не найдена');
    needs = parseNeeds(v.needs);
  } else {
    needs = categoryNeeds(catalog, target.id);
  }
  const [index, grade] = await Promise.all([loadConfirmedIndex(candidateId), loadProvenGrade(candidateId)]);
  return computeGaps(needs, catalog, index, grade);
}
