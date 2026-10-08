import { prisma } from '../db';
import type { CatalogEntry, EvidenceLevel } from '../claims/types';
import { getCatalog } from '../claims/catalog';
import { errors } from '../errors';
import type { Grade } from '../types';

import { adjacentOf } from './adjacency';
import { ADJACENT_FACTOR, bestLevel, levelWeight } from './weights';

/** Лучший прямой уровень по каждому catalogId. */
export type EvidenceIndex = Map<string, EvidenceLevel>;

export function buildIndex(claims: { catalogId: string; level: EvidenceLevel }[]): EvidenceIndex {
  const grouped = new Map<string, EvidenceLevel[]>();
  for (const c of claims) grouped.set(c.catalogId, [...(grouped.get(c.catalogId) ?? []), c.level]);
  const index: EvidenceIndex = new Map();
  for (const [id, levels] of grouped) index.set(id, bestLevel(levels)!);
  return index;
}

export interface Credit {
  /** Лучший прямой уровень (null — прямого утверждения нет). */
  direct: EvidenceLevel | null;
  /** Смежное утверждение, давшее зачёт, если прямого нет или оно слабее. */
  adjacentVia: string | null;
  credit: number;
}

/** Зачёт по утверждению: прямой уровень или половина лучшего смежного. Детерминированно. */
export function creditFor(catalogId: string, index: EvidenceIndex): Credit {
  const direct = index.get(catalogId) ?? null;
  let adjCredit = 0;
  let via: string | null = null;
  for (const adj of adjacentOf(catalogId)) {
    const w = levelWeight(index.get(adj)) * ADJACENT_FACTOR;
    if (w > adjCredit) {
      adjCredit = w;
      via = adj;
    }
  }
  const directCredit = levelWeight(direct);
  if (adjCredit > directCredit) return { direct, adjacentVia: via, credit: adjCredit };
  return { direct, adjacentVia: null, credit: directCredit };
}

export async function loadCatalog(): Promise<Map<string, CatalogEntry>> {
  const entries = await getCatalog();
  return new Map(entries.map((e) => [e.id, e]));
}

/** Подтверждённые кандидатом утверждения (confirmed | edited) — основа покрытия и пробелов. */
export async function loadConfirmedIndex(candidateId: string): Promise<EvidenceIndex> {
  const claims = await prisma.claim.findMany({
    where: { candidateId, status: { in: ['confirmed', 'edited'] } },
    select: { catalogId: true, level: true },
  });
  return buildIndex(claims);
}

/** Грейд из последней категории (теста) или null. */
export async function loadProvenGrade(candidateId: string): Promise<Grade | null> {
  const cat = await prisma.candidateCategory.findFirst({
    where: { candidateId },
    orderBy: { confirmedAt: 'desc' },
    select: { grade: true },
  });
  return cat?.grade ?? null;
}

export async function assertCandidate(candidateId: string) {
  const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!c) throw errors.notFound('Кандидат не найден');
  return c;
}

export interface Need {
  catalogId: string;
  weight: number;
}

/** needs вакансии из Json; мусор отбрасывается, порядок стабилен. */
export function parseNeeds(raw: unknown): Need[] {
  if (!Array.isArray(raw)) return [];
  const out: Need[] = [];
  for (const r of raw) {
    if (r && typeof r === 'object' && typeof (r as Need).catalogId === 'string') {
      const w = Number((r as Need).weight);
      out.push({ catalogId: (r as Need).catalogId, weight: Number.isFinite(w) && w > 0 ? w : 1 });
    }
  }
  return out;
}
