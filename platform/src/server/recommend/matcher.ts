import type { CatalogEntry } from '../claims/types';
import { prisma } from '../db';
import { errors } from '../errors';

import {
  assertCandidate,
  creditFor,
  loadCatalog,
  loadConfirmedIndex,
  parseNeeds,
  type EvidenceIndex,
  type Need,
} from './evidence';
import type { Coverage, CoverageItem } from './types';

export interface CoverageResult {
  items: (CoverageItem & { adjacentVia: string | null })[];
  /** Σ вес × зачёт / Σ вес, 0…1 */
  score: number;
  /** Требований с прямым утверждением кандидата */
  covered: number;
  total: number;
  missing: { catalogId: string; statement: string }[];
  adjacent: { catalogId: string; statement: string; via: string }[];
}

/**
 * Один матчер в обе стороны (работодатель ↔ кандидат). Покрытие считается
 * только по требованиям, которые есть в каталоге: чужой ID в needs пропускается.
 */
export function computeCoverage(needs: Need[], catalog: Map<string, CatalogEntry>, index: EvidenceIndex): CoverageResult {
  const items: CoverageResult['items'] = [];
  const missing: CoverageResult['missing'] = [];
  const adjacent: CoverageResult['adjacent'] = [];
  const seen = new Set<string>();
  let sumW = 0;
  let sumCredit = 0;
  let covered = 0;
  for (const need of needs) {
    const entry = catalog.get(need.catalogId);
    if (!entry || seen.has(need.catalogId)) continue;
    seen.add(need.catalogId);
    const c = creditFor(need.catalogId, index);
    items.push({
      catalogId: entry.id,
      statement: entry.statement,
      weight: need.weight,
      level: c.direct,
      credit: c.credit,
      adjacentVia: c.adjacentVia,
    });
    sumW += need.weight;
    sumCredit += need.weight * c.credit;
    if (c.direct) covered++;
    else {
      missing.push({ catalogId: entry.id, statement: entry.statement });
      if (c.adjacentVia) adjacent.push({ catalogId: entry.id, statement: entry.statement, via: c.adjacentVia });
    }
  }
  return {
    items,
    score: sumW > 0 ? Math.round((sumCredit / sumW) * 1e6) / 1e6 : 0,
    covered,
    total: items.length,
    missing,
    adjacent,
  };
}

/** «закрываешь k из n, не хватает: …» — только формулировки каталога. */
export function describeCoverage(r: CoverageResult, subject: 'candidate' | 'you' = 'you'): string {
  const verb = subject === 'you' ? 'закрываешь' : 'закрыто';
  let text = `${verb[0]!.toUpperCase()}${verb.slice(1)} ${r.covered} из ${r.total}`;
  if (r.missing.length > 0) text += `, не хватает: ${r.missing.map((m) => m.statement).join('; ')}`;
  if (r.adjacent.length > 0) {
    text += `. Смежное засчитано вдвое слабее: ${r.adjacent.map((a) => `${a.catalogId} (через ${a.via})`).join(', ')}`;
  }
  return text;
}

/** Покрытие потребности вакансии доказательствами кандидата (для приглашения). */
export async function explainInvitation(candidateId: string, invitationId: string): Promise<Coverage> {
  await assertCandidate(candidateId);
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId }, include: { vacancy: true } });
  // чужое приглашение — 404, не раскрываем существование
  if (!inv || inv.candidateId !== candidateId) throw errors.notFound('Приглашение не найдено');
  const [catalog, index] = await Promise.all([loadCatalog(), loadConfirmedIndex(candidateId)]);
  const r = computeCoverage(parseNeeds(inv.vacancy.needs), catalog, index);
  return {
    invitationId: inv.id,
    vacancyId: inv.vacancyId,
    items: r.items.map((i) => ({ catalogId: i.catalogId, statement: i.statement, weight: i.weight, level: i.level, credit: i.credit })),
    score: r.score,
    covered: r.covered,
    total: r.total,
    explanation: describeCoverage(r, 'candidate'),
  };
}
